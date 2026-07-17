"""
@fileoverview 分块数据加载器

功能概述:
- 支持大文件（>500MB）的分块读取和校验
- 对 CSV 文件使用 pandas chunksize 分块读取
- 对 Excel 文件按行范围分块读取
- 每个分块独立执行约束校验，合并结果

架构设计:
- 组合模式: ChunkedDataLoader 使用 DataSourceResolver 做路径解析
- 与 DataLoader 并行存在，由 ValidationExecutor 根据文件大小决定使用哪个
- 分块校验结果通过 ChunkedValidationResult 聚合

输入示例:
    loader = ChunkedDataLoader(resolver, dataset_schema, schema_by_id, settings)
    result = loader.load_and_validate_chunked(data_directory, schema, engine_fn)

输出示例:
    result = ChunkedValidationResult(
        parsed_datasets={...},
        errors=[...],
        validation_details={...},
        chunk_count=5,
        total_rows=500000
    )
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from app.shared.core.data_source.schema_info import DataSourceInfo
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain.dataset_schema import DataSetSchema, TableSchema

from .memory_monitor import MemoryMonitor
from .resolver import DataSourceResolver

logger = logging.getLogger(__name__)


@dataclass
class ChunkedValidationResult:
    """分块校验结果聚合。"""

    parsed_datasets: dict[str, pd.DataFrame] = field(default_factory=dict)
    errors: list[dict] = field(default_factory=list)
    validation_details: dict[str, list[dict]] = field(
        default_factory=lambda: {"format_checks": [], "constraint_checks": []}
    )
    loading_errors: list[dict] = field(default_factory=list)
    chunk_count: int = 0
    total_rows: int = 0
    warnings: list[str] = field(default_factory=list)


class ChunkedDataLoader:
    """
    @classdesc 分块数据加载器

    负责：
    - 对大文件进行分块读取
    - 每个分块独立执行格式解析和约束校验
    - 聚合所有分块的校验结果

    设计决策：
    - CSV 使用 pandas read_csv(chunksize=...) 流式读取
    - Excel 按行范围分块读取（pandas read_excel + skiprows/nrows）
    - JSON 不支持分块（需全量加载），但仍可对加载后的 DataFrame 分块校验
    """

    def __init__(
        self,
        resolver: DataSourceResolver,
        dataset_schema: DataSetSchema,
        schema_by_id: dict[str, TableSchemaFile],
        settings: Any,
        memory_monitor: MemoryMonitor | None = None,
    ):
        self._resolver = resolver
        self.dataset_schema = dataset_schema
        self._schema_by_id = schema_by_id
        self.settings = settings
        self._monitor = memory_monitor or MemoryMonitor()

    def _load_csv_chunked(
        self,
        file_path: str,
        schema: TableSchema,
        chunk_size: int,
    ) -> list[pd.DataFrame]:
        """
        @methoddesc 分块加载 CSV 文件

        使用 pandas read_csv 的 chunksize 参数进行流式读取。

        参数:
            file_path: CSV 文件路径
            schema: 表 Schema 定义
            chunk_size: 每个分块的行数

        返回:
            DataFrame 分块列表
        """
        try:
            # B25 修复：优先读取 source_config.encoding，过去硬编码 utf-8-sig 导致非 UTF-8 文件乱码
            config_encoding = None
            if hasattr(schema, "source_config") and schema.source_config:
                config_encoding = schema.source_config.get("encoding")
            encoding = config_encoding or "utf-8-sig"
            read_kwargs: dict[str, Any] = {
                "header": schema.header_row if schema.header_row is not None else 0,
                "encoding": encoding,
                "chunksize": chunk_size,
            }

            if hasattr(schema, "source_config") and schema.source_config:
                delimiter = schema.source_config.get("delimiter", ",")
                read_kwargs["sep"] = delimiter

            chunks: list[pd.DataFrame] = []
            for chunk in pd.read_csv(file_path, **read_kwargs):
                chunks.append(chunk)

            logger.info(f"CSV 分块加载完成: {os.path.basename(file_path)}, {len(chunks)} 个分块")
            return chunks

        except Exception as e:
            logger.error(f"CSV 分块加载失败: {file_path}, 错误: {e}")
            raise

    def _load_excel_chunked(
        self,
        file_path: str,
        sheet_name: str,
        header_row: int,
        chunk_size: int,
    ) -> list[pd.DataFrame]:
        """
        @methoddesc 分块加载 Excel 文件

        Excel 不支持原生 chunksize，通过多次调用 read_excel（skiprows + nrows）实现分块。

        参数:
            file_path: Excel 文件路径
            sheet_name: Sheet 名称
            header_row: 表头行号
            chunk_size: 每个分块的行数

        返回:
            DataFrame 分块列表
        """
        try:
            # 先读取表头确定列数
            header_df = pd.read_excel(
                file_path,
                sheet_name=sheet_name,
                header=header_row,
                nrows=0,
            )
            columns = header_df.columns.tolist()

            if not columns:
                logger.warning(f"Excel 文件无列: {file_path}, sheet={sheet_name}")
                return []

            chunks: list[pd.DataFrame] = []
            current_skip = header_row + 1  # 跳过表头行
            # 回归 #8: 累计已读数据行数(不含表头),用于给每块设置全局连续的 0-based 数据行号,
            # 使约束校验的 row_index 反映行在原文件的真实数据位置(与 CSV 分块的全局连续 index 对齐)。
            data_row_offset = 0

            while True:
                read_kwargs: dict[str, Any] = {
                    "sheet_name": sheet_name,
                    "header": None,
                    "skiprows": current_skip,
                    "nrows": chunk_size,
                }

                chunk = pd.read_excel(file_path, **read_kwargs)

                if chunk.empty:
                    break

                # 设置列名
                if len(chunk.columns) == len(columns):
                    chunk.columns = columns

                # 回归 #8: 把块内 index 重置为全局连续的数据行号(从 data_row_offset 开始),
                # 而非 pd.read_excel 默认的每块从 0 重启的 RangeIndex。否则第 2 块起 row_index
                # 与原文件位置错位,财务/审计场景无法据报告行号定位错误。
                chunk.index = range(data_row_offset, data_row_offset + len(chunk))

                chunks.append(chunk)
                current_skip += chunk_size
                data_row_offset += len(chunk)

                # 如果返回的行数小于 chunk_size，说明已到文件末尾
                if len(chunk) < chunk_size:
                    break

            logger.info(f"Excel 分块加载完成: {os.path.basename(file_path)}, {len(chunks)} 个分块")
            return chunks

        except Exception as e:
            logger.error(f"Excel 分块加载失败: {file_path}, 错误: {e}")
            raise

    def _load_dataframe_chunked(
        self,
        file_path: str,
        schema: TableSchema,
        chunk_size: int,
    ) -> list[pd.DataFrame]:
        """
        @methoddesc 根据文件类型选择分块加载策略

        参数:
            file_path: 数据文件路径
            schema: 表 Schema 定义
            chunk_size: 每个分块的行数

        返回:
            DataFrame 分块列表
        """
        ext = os.path.splitext(file_path)[1].lower()

        if ext == ".csv":
            return self._load_csv_chunked(file_path, schema, chunk_size)
        elif ext in (".xlsx", ".xls"):
            sheet_name = getattr(schema, "sheet_name", None) or "Sheet1"
            header_row = getattr(schema, "header_row", 0) or 0
            return self._load_excel_chunked(file_path, sheet_name, header_row, chunk_size)
        else:
            # JSON 等格式不支持分块，全量加载后按行切分
            logger.info(f"文件格式 {ext} 不支持原生分块加载，将全量加载后切分")
            from app.shared.core.data_source.loader import _LOADER_FNS

            loader_fn = _LOADER_FNS.get(ext)
            if not loader_fn:
                raise ValueError(f"不支持的文件格式: {ext}")

            info = DataSourceInfo(
                schema_id=getattr(schema, "id", None) or getattr(schema, "name", None) or "",
                name=getattr(schema, "name", None),
                sheet_name=getattr(schema, "sheet_name", None),
                header_row=getattr(schema, "header_row", 0),
                source_config=getattr(schema, "source_config", {}),
            )
            full_datasets = loader_fn(file_path, [info])
            if not full_datasets:
                return []

            # 取第一个 DataFrame 进行分块切分
            df = next(iter(full_datasets.values()))
            return [df[i : i + chunk_size] for i in range(0, len(df), chunk_size)]

    def load_chunked_sources(
        self,
        data_directory: str,
        table_filter: str | list[str] | None = None,
    ) -> tuple[dict[str, list[pd.DataFrame]], list[dict]]:
        """
        @methoddesc 分块加载所有数据源

        对需要分块的大文件进行分块读取，小文件返回单个分块。

        参数:
            data_directory: 数据文件所在目录
            table_filter: 表过滤条件

        返回:
            二元组 (datasets, loading_errors):
            - datasets: 键为表 ID，值为 DataFrame 分块列表
            - loading_errors: 加载阶段产生的错误列表（源找不到、加载异常等），
              供 executor 上报到校验报告。回归 #5: 原实现吞掉所有错误导致损坏表静默消失。
        """
        chunked_datasets: dict[str, list[pd.DataFrame]] = {}
        loading_errors: list[dict] = []

        # 解析搜索目录
        search_directory = data_directory
        first_data_source = self._resolver.resolve_first_data_source()
        if first_data_source:
            search_directory = first_data_source

        if not os.path.isdir(search_directory):
            logger.error(f"数据目录不存在: {data_directory}")
            return chunked_datasets, loading_errors

        # 处理过滤
        filter_set: set | None = None
        if table_filter:
            if isinstance(table_filter, str):
                filter_set = {table_filter}
            else:
                filter_set = set(table_filter)

        for table_id, table_schema in self.dataset_schema.tables.items():
            schema_file = self._schema_by_id.get(table_id)
            if not schema_file:
                continue

            # 应用过滤
            if filter_set:
                table_name = table_schema.name or table_id
                if table_name not in filter_set and table_id not in filter_set:
                    continue

            table_name = table_schema.name or table_id

            # 解析数据源路径
            source_path, _ = self._resolver.resolve_source_path(data_directory, schema_file)
            if not source_path:
                # 回归 #5: 源找不到必须上报,否则该表静默消失、报告显示"全部通过"。
                logger.warning(f"表 '{table_name}' 未找到数据源，跳过分块加载")
                loading_errors.append(
                    {
                        "error_type": "SourceNotFound",
                        "table": table_name,
                        "message": f"表 '{table_name}' 未找到数据源，已跳过分块加载。",
                    }
                )
                continue

            # 判断是否需要分块
            if self._monitor.should_chunk(source_path):
                self._monitor.take_snapshot(source_path)
                logger.info(f"表 '{table_name}' 文件较大，启用分块加载模式")

                try:
                    chunks = self._load_dataframe_chunked(source_path, table_schema, self._monitor.chunk_rows)
                    chunked_datasets[table_id] = chunks
                except Exception as e:
                    logger.error(f"分块加载失败: {table_id}, 错误: {e}")
                    # 回退到全量加载
                    logger.info(f"回退到全量加载: {table_id}")
                    try:
                        from app.shared.core.data_source.loader import load_grouped_sources

                        info = DataSourceInfo(
                            schema_id=table_id,
                            name=getattr(table_schema, "name", table_id),
                            sheet_name=getattr(table_schema, "sheet_name", None),
                            header_row=getattr(table_schema, "header_row", 0),
                            source_config=getattr(table_schema, "source_config", None) or {},
                        )
                        file_to_schemas = {source_path: [info]}
                        loaded, _ = load_grouped_sources(file_to_schemas)
                        if loaded:
                            df = next(iter(loaded.values()))
                            chunked_datasets[table_id] = [df]
                        else:
                            loading_errors.append(
                                {
                                    "error_type": "DataLoadingError",
                                    "table": table_name,
                                    "message": f"表 '{table_name}' 分块加载及全量回退均未返回数据。",
                                }
                            )
                    except Exception as fallback_err:
                        logger.error(f"全量加载也失败: {table_id}, 错误: {fallback_err}")
                        loading_errors.append(
                            {
                                "error_type": "DataLoadingError",
                                "table": table_name,
                                "message": f"表 '{table_name}' 加载失败: 分块错误({e}); 全量回退错误({fallback_err})。",
                            }
                        )
            else:
                # 小文件，全量加载为单个分块
                try:
                    from app.shared.core.data_source.loader import load_grouped_sources

                    info = DataSourceInfo(
                        schema_id=table_id,
                        name=getattr(table_schema, "name", table_id),
                        sheet_name=getattr(table_schema, "sheet_name", None),
                        header_row=getattr(table_schema, "header_row", 0),
                        source_config=getattr(table_schema, "source_config", None) or {},
                    )
                    file_to_schemas = {source_path: [info]}
                    loaded, _ = load_grouped_sources(file_to_schemas)
                    if loaded:
                        df = next(iter(loaded.values()))
                        chunked_datasets[table_id] = [df]
                    else:
                        loading_errors.append(
                            {
                                "error_type": "DataLoadingError",
                                "table": table_name,
                                "message": f"表 '{table_name}' 加载未返回数据。",
                            }
                        )
                except Exception as e:
                    logger.error(f"加载失败: {table_id}, 错误: {e}")
                    loading_errors.append(
                        {
                            "error_type": "DataLoadingError",
                            "table": table_name,
                            "message": f"表 '{table_name}' 加载失败: {e}",
                        }
                    )

        return chunked_datasets, loading_errors
