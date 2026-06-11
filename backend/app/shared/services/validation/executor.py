# backend/app/shared/services/validation/executor.py
"""
@fileoverview 全量校验执行器

功能概述:
- 提供 CLI 和前端共享的核心校验编排逻辑
- 编排加载→格式解析→约束校验→结果后处理全流程
- 支持超时控制、设置覆盖、表过滤等执行选项
- 提供 ValidationOptions 配置类和 create_executor 工厂函数

架构设计:
- 组合模式: ValidationExecutor 组合使用 DataSourceResolver + DataLoader
- 职责分离: 自身仅负责流程编排，路径解析和数据加载委托给子模块
- 调用方: CLI 的 DataValidator 和前端 API 的 validate_v2_full

输入示例:
    executor = create_executor("project.precis.yaml")
    options = ValidationOptions(timeout_seconds=30, strict_mode=False)
    result = executor.execute(data_directory="./data", options=options)

输出示例:
    result = {
        "success": True,
        "errors": [...],
        "parsed_datasets": {...}
    }
"""

import logging
import os
import time
from typing import Any, Optional, Union

import pandas as pd

from app.shared.core.project.loader import LoadedProject, load_project
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain.dataset_schema import DataSetSchema

from .chunked_loader import ChunkedDataLoader
from .data_loader import DataLoader
from .engine import validate_full_dataset
from .memory_monitor import MemoryMonitor
from .resolver import DataSourceResolver

logger = logging.getLogger(__name__)


class ValidationOptions:
    """
    @classdesc 校验执行选项

    用于配置校验执行的可选参数，支持前端覆盖配置。
    包含超时控制、错误处理策略、严格模式、表过滤等设置。

    属性:
        timeout_seconds: 超时时间（秒），默认 30 秒
        error_handling: 错误处理策略，"continue" 表示遇到错误继续执行
        strict_mode: 严格模式，True 时任何错误都视为校验失败
        allow_unsafe_eval: 是否允许不安全脚本执行，None 表示使用项目配置
        table_filter: 表过滤列表，只校验指定表相关的约束
    """

    def __init__(
        self,
        timeout_seconds: int = 30,
        error_handling: str = "continue",
        strict_mode: bool = False,
        allow_unsafe_eval: Optional[bool] = None,
        table_filter: Optional[Union[str, list[str]]] = None,
        chunk_threshold_mb: float = 500,
        chunk_rows: int = 100_000,
    ):
        self.timeout_seconds = timeout_seconds
        self.error_handling = error_handling
        self.strict_mode = strict_mode
        self.allow_unsafe_eval = allow_unsafe_eval
        self.table_filter = table_filter
        self.chunk_threshold_mb = chunk_threshold_mb
        self.chunk_rows = chunk_rows


class ValidationExecutor:
    """
    @classdesc 全量校验执行器

    负责：
    - 加载项目配置和 Schema 定义
    - 委托 DataSourceResolver 解析数据源路径
    - 委托 DataLoader 批量加载数据文件
    - 编排格式解析和约束校验
    - 结果后处理（ID→Name 映射）
    - 超时控制
    """

    def __init__(
        self,
        manifest_path: str,
        settings_override: Any = None,
    ):
        # 校验清单文件存在性
        # 【防御性编程】在初始化阶段即检查文件是否存在，避免后续操作失败
        if not os.path.exists(manifest_path):
            raise FileNotFoundError(f"项目配置文件未找到: {manifest_path}")

        # 解析项目根目录并加载项目配置
        # 【数据流】manifest_path → project_root → load_project → LoadedProject
        self.project_root = os.path.dirname(manifest_path)
        self.loaded_project: LoadedProject = load_project(manifest_path)
        self.dataset_schema: DataSetSchema = self.loaded_project.dataset_schema
        self.settings = self.loaded_project.manifest.settings
        self.manifest = self.loaded_project.manifest

        # 应用前端或 CLI 传入的设置覆盖值
        # 【配置优先级】settings_override > 项目配置 > 默认值
        if settings_override:
            self._apply_settings_override(settings_override)

        # 构建表 ID 到 Schema 文件的映射，便于快速查找
        self._schema_by_id: dict[str, TableSchemaFile] = dict(self.loaded_project.schema_files)

        # 初始化数据源解析器，负责将相对路径解析为绝对路径
        self._resolver = DataSourceResolver(
            project_root=self.project_root,
            manifest=self.manifest,
            schema_by_id=self._schema_by_id,
        )
        # 初始化数据加载器，负责批量加载数据文件
        self._data_loader = DataLoader(
            resolver=self._resolver,
            dataset_schema=self.dataset_schema,
            schema_by_id=self._schema_by_id,
            settings=self.settings,
        )
        # 初始化内存监控器
        self._memory_monitor = MemoryMonitor()
        # 初始化分块数据加载器（惰性创建，仅在需要时使用）
        self._chunked_loader: Optional[ChunkedDataLoader] = None

    def _get_chunked_loader(self, options: ValidationOptions) -> ChunkedDataLoader:
        """获取或创建分块数据加载器。"""
        if self._chunked_loader is None:
            self._memory_monitor.chunk_threshold_mb = options.chunk_threshold_mb
            self._memory_monitor.chunk_rows = options.chunk_rows
            self._chunked_loader = ChunkedDataLoader(
                resolver=self._resolver,
                dataset_schema=self.dataset_schema,
                schema_by_id=self._schema_by_id,
                settings=self.settings,
                memory_monitor=self._memory_monitor,
            )
        return self._chunked_loader

    def _apply_settings_override(self, override: Any):
        """
        @methoddesc 应用设置覆盖

        将前端或 CLI 传入的设置覆盖值应用到项目配置中。
        支持 Pydantic 模型和字典两种格式的覆盖值。

        参数:
            override: 设置覆盖值，可以是 Pydantic 模型或字典

        异常:
            TypeError: override 类型不支持（非 dict 非 Pydantic 模型）
            ValueError: 覆盖值包含未知字段
        """
        if override is None:
            return

        # 统一转换为字典格式
        if hasattr(override, "model_dump"):
            override_dict = override.model_dump(exclude_none=True)
        elif isinstance(override, dict):
            override_dict = override
        else:
            raise TypeError("settings_override 必须为 dict 或 Pydantic 模型")

        # 校验根级别字段是否合法
        allowed_root = {"validation", "file_processing", "script_security"}
        unknown_root = set(override_dict.keys()) - allowed_root
        if unknown_root:
            raise ValueError(f"settings_override 包含未知字段: {sorted(unknown_root)}")

        # 逐组应用覆盖值
        for group_name in ("validation", "file_processing", "script_security"):
            group_override = override_dict.get(group_name)
            if not group_override:
                continue
            if not isinstance(group_override, dict):
                raise ValueError(f"settings_override.{group_name} 必须为对象")
            target = getattr(self.settings, group_name, None)
            if target is None:
                continue
            for key, value in group_override.items():
                if not hasattr(target, key):
                    raise ValueError(f"settings_override.{group_name} 包含未知字段: {key}")
                setattr(target, key, value)

    def _build_table_source_map(self) -> dict[str, dict[str, str | None]]:
        """
        @methoddesc 构建表 ID 到数据源信息的映射字典

        用于在校验结果中附加数据源文件名和 Sheet 名，
        使前端能够显示"配置文件内定义的文件名+Sheet名"格式的位置信息。

        返回:
            映射字典，键为表 ID，值为 {"source_file": ..., "source_sheet": ...}
        """
        result: dict[str, dict[str, str | None]] = {}
        for table_id, schema_file in self._schema_by_id.items():
            source_file = None
            source_sheet = None
            if schema_file.source:
                source_file = schema_file.source.path
                source_sheet = schema_file.source.sheet
            if not source_sheet and schema_file.sheet:
                source_sheet = schema_file.sheet
            result[table_id] = {"source_file": source_file, "source_sheet": source_sheet}
        return result

    @staticmethod
    def _attach_source_info(item: dict[str, Any], table_source_map: dict[str, dict[str, str | None]]) -> None:
        """
        @methoddesc 将数据源信息附加到错误/通过项字典中

        根据 item 中的 table 或 table_id 查找对应的数据源配置，
        并将 source_file 和 source_sheet 写入 item。

        参数:
            item: 包含 table/table_id 的字典（会被就地修改）
            table_source_map: 表 ID → 数据源信息的映射
        """
        table_id = item.get("table_id") or item.get("table")
        if table_id and table_id in table_source_map:
            item["source_file"] = table_source_map[table_id]["source_file"]
            item["source_sheet"] = table_source_map[table_id]["source_sheet"]

    @staticmethod
    def _build_id_to_name_map(dataset_schema: DataSetSchema) -> dict[str, str]:
        """
        @methoddesc 构建表 ID 到显示名称的映射字典

        用于在校验结果中将内部表 ID 替换为用户友好的表名称。

        参数:
            dataset_schema: 数据集 Schema 定义

        返回:
            映射字典，键为表 ID，值为表显示名称
        """
        id_to_name: dict[str, str] = {}
        if dataset_schema and dataset_schema.tables:
            for tid, schema in dataset_schema.tables.items():
                target_name = schema.name or tid
                if schema.id:
                    id_to_name[schema.id] = target_name
                id_to_name[tid] = target_name
        return id_to_name

    def _postprocess_result(self, result: dict[str, Any]) -> None:
        id_to_name = self._build_id_to_name_map(self.dataset_schema)
        table_source_map = self._build_table_source_map()

        for error in result["errors"]:
            self._map_table_id(error, id_to_name)
            self._attach_source_info(error, table_source_map)
        for error in result["loading_errors"]:
            self._map_table_id(error, id_to_name)
            self._attach_source_info(error, table_source_map)
        if "format_checks" in result["validation_details"]:
            for item in result["validation_details"]["format_checks"]:
                self._map_table_id(item, id_to_name)
                self._attach_source_info(item, table_source_map)
        if "constraint_checks" in result["validation_details"]:
            for item in result["validation_details"]["constraint_checks"]:
                self._map_table_id(item, id_to_name)
                self._attach_source_info(item, table_source_map)

    def _finalize_result(self, result: dict[str, Any], started: float) -> None:
        result["duration_ms"] = int((time.monotonic() - started) * 1000)
        result["memory_info"] = self._memory_monitor.get_progress_info()

    @staticmethod
    def _map_table_id(item: dict[str, Any], id_to_name: dict[str, str]):
        """
        @methoddesc 将错误信息中的表 ID 替换为表显示名称

        就地修改传入的字典，将 table/from_table/to_table 字段中的
        内部 ID 替换为用户可读的名称。

        参数:
            item: 包含表相关字段的错误信息字典
            id_to_name: ID 到名称的映射字典
        """
        for key in ("table", "from_table", "to_table"):
            if key in item and item[key] in id_to_name:
                item[key] = id_to_name[item[key]]

    def execute(
        self,
        data_directory: str,
        options: ValidationOptions = None,
    ) -> dict[str, Any]:
        """
        @methoddesc 执行完整校验流程

        编排数据加载、格式解析、约束校验和结果后处理的完整流程。
        采用分阶段执行策略，每个阶段后检查超时条件。
        当检测到大文件时自动切换到分块处理模式。

        执行流程:
            Step 1: 检测文件大小，决定使用标准模式还是分块模式
            Step 2: 加载数据源（标准 DataLoader 或 ChunkedDataLoader）
            Step 3: 检查加载阶段超时
            Step 4: 检查数据加载成功
            Step 5: 确定脚本安全执行策略
            Step 6: 执行格式解析和约束校验
            Step 7: 结果后处理（ID→Name 映射 + 数据源信息附加）
            Step 8: 检查校验阶段超时

        参数:
            data_directory: 数据文件所在目录
            options: 校验执行选项，包含超时、过滤等配置

        返回:
            包含以下字段的字典:
                - raw_datasets: 原始数据集
                - parsed_datasets: 解析后的数据集
                - errors: 校验错误列表
                - loading_errors: 数据加载错误列表
                - duration_ms: 执行耗时（毫秒）
                - timeout_occurred: 是否发生超时
                - validation_details: 校验详情
                - chunked_mode: 是否使用了分块模式
                - memory_info: 内存监控信息
        """
        if options is None:
            options = ValidationOptions()

        # 更新内存监控器配置
        self._memory_monitor.chunk_threshold_mb = options.chunk_threshold_mb
        self._memory_monitor.chunk_rows = options.chunk_rows

        # 记录开始时间，用于计算总耗时和超时检查
        started = time.monotonic()
        result: dict[str, Any] = {
            "raw_datasets": {},
            "parsed_datasets": {},
            "errors": [],
            "loading_errors": [],
            "duration_ms": 0,
            "timeout_occurred": False,
            "validation_details": {"format_checks": [], "constraint_checks": []},
            "chunked_mode": False,
            "memory_info": {},
        }

        # Step 1: 检测是否需要分块模式
        use_chunked = self._should_use_chunked_mode(data_directory, options)
        if use_chunked:
            result["chunked_mode"] = True
            logger.info("检测到大文件，启用分块处理模式")
            return self._execute_chunked(data_directory, options, started, result)

        # Step 2: 加载数据源（标准模式）
        raw_datasets, loading_errors = self._data_loader.load_data_sources(
            data_directory, table_filter=options.table_filter
        )
        result["raw_datasets"] = raw_datasets
        result["loading_errors"] = loading_errors

        # 追加项目加载阶段的错误
        for err in self.loaded_project.loading_errors:
            result["loading_errors"].append(err.to_dict())

        result["warnings"] = self.loaded_project.warnings

        # Step 3: 检查加载阶段是否超时
        if (time.monotonic() - started) > options.timeout_seconds:
            result["errors"].append(
                {"error_type": "Timeout", "message": f"数据加载阶段超时（>{options.timeout_seconds}s）"}
            )
            result["timeout_occurred"] = True
            self._finalize_result(result, started)
            return result

        # Step 4: 检查数据是否加载成功
        if not raw_datasets:
            result["errors"].append(
                {"error_type": "DataLoadingError", "message": "未能从数据目录加载任何数据表，校验中止。"}
            )
            self._finalize_result(result, started)
            return result

        # Step 5: 确定脚本安全执行策略
        allow_unsafe_eval = False

        logger.debug(f"Starting validate_full_dataset with {len(raw_datasets)} datasets")

        # 计算校验阶段的超时截止时间
        deadline = started + options.timeout_seconds

        # Step 6: 执行格式解析和约束校验
        try:
            parsed_datasets, validation_errors, validation_details = validate_full_dataset(
                raw_datasets,
                self.dataset_schema,
                allow_unsafe_eval=allow_unsafe_eval,
                table_filter=options.table_filter,
                transform_files=getattr(self.loaded_project, "transform_files", None) if self.loaded_project else None,
                regex_files=getattr(self.loaded_project, "regex_node_files", None) if self.loaded_project else None,
                deadline=deadline,
            )
        except Exception as e:
            logger.exception(f"Error during validate_full_dataset: {e}")
            raise
        result["parsed_datasets"] = parsed_datasets
        result["errors"].extend(validation_errors)
        result["validation_details"] = validation_details

        # Step 7: 结果后处理
        self._postprocess_result(result)

        # Step 8: 检查校验阶段是否超时
        if (time.monotonic() - started) > options.timeout_seconds:
            result["errors"].append(
                {"error_type": "Timeout", "message": f"数据校验阶段超时（>{options.timeout_seconds}s）"}
            )
            result["timeout_occurred"] = True

        self._finalize_result(result, started)
        return result

    def _should_use_chunked_mode(self, data_directory: str, options: ValidationOptions) -> bool:
        """
        @methoddesc 检测数据目录中是否有需要分块处理的大文件

        参数:
            data_directory: 数据文件目录
            options: 校验选项

        返回:
            True 表示存在需要分块处理的大文件
        """
        search_directory = data_directory
        first_data_source = self._resolver.resolve_first_data_source()
        if first_data_source:
            search_directory = first_data_source

        if not os.path.isdir(search_directory):
            return False

        for table_id, schema_file in self._schema_by_id.items():
            source_path, _ = self._resolver.resolve_source_path(data_directory, schema_file)
            if source_path and self._memory_monitor.should_chunk(source_path):
                return True

        return False

    def _execute_chunked(
        self,
        data_directory: str,
        options: ValidationOptions,
        started: float,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        """
        @methoddesc 执行分块校验流程

        使用 ChunkedDataLoader 分块加载数据，逐块执行格式解析和约束校验，
        最终合并所有分块的结果。

        参数:
            data_directory: 数据文件目录
            options: 校验选项
            started: 开始时间
            result: 结果字典（已初始化）

        返回:
            完整的校验结果字典
        """
        chunked_loader = self._get_chunked_loader(options)

        # 分块加载数据源
        try:
            chunked_datasets = chunked_loader.load_chunked_sources(data_directory, table_filter=options.table_filter)
        except Exception as e:
            logger.exception(f"分块加载失败: {e}")
            result["errors"].append({"error_type": "ChunkedLoadError", "message": f"分块加载失败: {e}"})
            self._finalize_result(result, started)
            return result

        # 追加项目加载阶段的错误
        for err in self.loaded_project.loading_errors:
            result["loading_errors"].append(err.to_dict())
        result["warnings"] = self.loaded_project.warnings

        if not chunked_datasets:
            result["errors"].append(
                {"error_type": "DataLoadingError", "message": "未能从数据目录加载任何数据表，校验中止。"}
            )
            self._finalize_result(result, started)
            return result

        # 统计总行数和分块数
        total_rows = 0
        total_chunks = 0
        for table_id, chunks in chunked_datasets.items():
            for chunk in chunks:
                total_rows += len(chunk)
            total_chunks += len(chunks)

        logger.info(f"分块加载完成: {len(chunked_datasets)} 个表, {total_chunks} 个分块, {total_rows} 总行数")

        # 记录原始数据集信息（用于响应）
        for table_id, chunks in chunked_datasets.items():
            result["raw_datasets"][table_id] = {"chunk_count": len(chunks), "row_count": sum(len(c) for c in chunks)}

        # 检查加载阶段超时
        if (time.monotonic() - started) > options.timeout_seconds:
            result["errors"].append(
                {"error_type": "Timeout", "message": f"数据加载阶段超时（>{options.timeout_seconds}s）"}
            )
            result["timeout_occurred"] = True
            self._finalize_result(result, started)
            return result

        # 确定脚本安全策略
        allow_unsafe_eval = False
        deadline = started + options.timeout_seconds

        # 逐块执行校验，聚合结果
        all_parsed_datasets: dict[str, list[pd.DataFrame]] = {}
        all_errors: list[dict] = []
        all_validation_details: dict[str, list[dict]] = {
            "format_checks": [],
            "constraint_checks": [],
        }

        for table_id, chunks in chunked_datasets.items():
            all_parsed_datasets[table_id] = []

            for chunk_idx, chunk_df in enumerate(chunks):
                # 超时检查
                if deadline is not None and time.monotonic() > deadline:
                    logger.warning(f"分块校验超时: 表 {table_id} 分块 {chunk_idx + 1}/{len(chunks)}")
                    all_errors.append(
                        {
                            "error_type": "Timeout",
                            "stage": "constraint",
                            "check_type": "Timeout",
                            "message": f"分块校验超时，表 {table_id} 剩余分块未执行",
                            "table": table_id,
                        }
                    )
                    break

                try:
                    parsed_datasets, validation_errors, validation_details = validate_full_dataset(
                        {table_id: chunk_df},
                        self.dataset_schema,
                        allow_unsafe_eval=allow_unsafe_eval,
                        table_filter=options.table_filter,
                        transform_files=getattr(self.loaded_project, "transform_files", None)
                        if self.loaded_project
                        else None,
                        regex_files=getattr(self.loaded_project, "regex_node_files", None)
                        if self.loaded_project
                        else None,
                        deadline=deadline,
                    )

                    # 收集解析后的数据
                    for tid, parsed_df in parsed_datasets.items():
                        all_parsed_datasets[tid].append(parsed_df)

                    # 聚合错误（添加分块信息）
                    for err in validation_errors:
                        err["chunk_index"] = chunk_idx
                        all_errors.append(err)

                    # 聚合校验详情
                    for check in validation_details.get("format_checks", []):
                        all_validation_details["format_checks"].append(check)
                    for check in validation_details.get("constraint_checks", []):
                        all_validation_details["constraint_checks"].append(check)

                except Exception as e:
                    logger.exception(f"分块校验异常: 表 {table_id} 分块 {chunk_idx}: {e}")
                    all_errors.append(
                        {
                            "error_type": "ChunkValidationError",
                            "stage": "constraint",
                            "message": f"分块校验异常: {e}",
                            "table": table_id,
                            "chunk_index": chunk_idx,
                        }
                    )

        # 合并分块的解析结果
        for table_id, dfs in all_parsed_datasets.items():
            if dfs:
                result["parsed_datasets"][table_id] = pd.concat(dfs, ignore_index=True)

        result["errors"] = all_errors
        result["validation_details"] = all_validation_details

        # 结果后处理
        self._postprocess_result(result)

        # 检查总超时
        if (time.monotonic() - started) > options.timeout_seconds:
            result["timeout_occurred"] = True

        self._finalize_result(result, started)
        return result


def create_executor(manifest_path: str, settings_override: dict[str, Any] = None) -> ValidationExecutor:
    """
    @methoddesc 创建校验执行器工厂函数

    便捷函数，用于快速创建 ValidationExecutor 实例。

    参数:
        manifest_path: 项目清单文件路径
        settings_override: 可选的设置覆盖值

    返回:
        ValidationExecutor 实例

    示例:
        >>> executor = create_executor("project.precis.yaml")
        >>> result = executor.execute("./data")
    """
    return ValidationExecutor(manifest_path, settings_override)
