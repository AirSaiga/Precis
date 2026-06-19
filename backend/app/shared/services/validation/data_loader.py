"""
@fileoverview 数据加载器

功能概述:
- 按解析后的文件路径分组 Schema，支持同一 Excel 多 sheet 加载
- 支持表过滤（table_filter）及外键关联表自动收集
- 批量加载数据文件并返回原始 DataFrame 字典
- 收集加载过程中的错误（如目录不存在、数据源未找到）

架构设计:
- 单一职责模式: 只做数据加载，不涉及校验逻辑
- 组合依赖 DataSourceResolver 做路径解析
- 从 ValidationExecutor 中提取，独立为可复用组件

输入示例:
    loader = DataLoader(resolver, dataset_schema, schema_by_id, settings)
    raw_datasets, errors = loader.load_data_sources("./data", table_filter=["users"])

输出示例:
    raw_datasets = {"users": pd.DataFrame(...), "orders": pd.DataFrame(...)}
    errors = [{"error_type": "SourceNotFound", "message": "...", "table": "..."}]
"""

import logging
import os
from collections import defaultdict
from typing import Any, Optional, Union

import pandas as pd

from app.shared.core.data_source.loader import load_grouped_sources
from app.shared.core.data_source.schema_info import DataSourceInfo
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain.dataset_schema import DataSetSchema

from .resolver import DataSourceResolver

logger = logging.getLogger(__name__)


class DataLoader:
    """
    @classdesc 数据加载器

    负责：
    - 按解析后的文件路径分组 Schema（支持同一 Excel 多 sheet）
    - 表过滤（table_filter）及外键关联表自动收集
    - 批量加载数据文件并返回原始 DataFrame 字典

    设计决策：
    - 从 ValidationExecutor 中提取，单一职责：只做数据加载，不涉及校验
    - 通过组合依赖 DataSourceResolver 做路径解析
    """

    def __init__(
        self,
        resolver: DataSourceResolver,
        dataset_schema: DataSetSchema,
        schema_by_id: dict[str, TableSchemaFile],
        settings: Any,
    ):
        self._resolver = resolver
        self.dataset_schema = dataset_schema
        self._schema_by_id = schema_by_id
        self.settings = settings

    def _resolve_search_directory(self, data_directory: str) -> str:
        """
        @methoddesc 解析实际的数据搜索目录

        如果 manifest 中配置了数据源目录，优先使用配置目录；
        否则使用传入的数据目录。

        参数:
            data_directory: 默认数据目录

        返回:
            实际用于搜索数据文件的目录路径
        """
        search_directory = data_directory
        first_data_source = self._resolver.resolve_first_data_source()
        if first_data_source:
            search_directory = first_data_source
        return search_directory

    def _collect_foreign_key_tables(self, filter_set: set) -> set:
        """
        @methoddesc 收集外键关联表

        当指定了 table_filter 时，除了过滤表本身，
        还需要加载这些表引用的外键目标表，否则外键约束无法校验。

        参数:
            filter_set: 用户指定的过滤表集合

        返回:
            扩展后的表集合（包含外键引用的目标表）
        """
        tables_to_load = set(filter_set)
        for constraint in self.dataset_schema.constraints:
            # ForeignKeyConstraints 使用 from_table 而非 table 属性
            constraint_table = getattr(constraint, "from_table", None)
            if constraint_table and constraint_table in filter_set:
                if hasattr(constraint, "to_table") and constraint.to_table:
                    tables_to_load.add(constraint.to_table)
                if hasattr(constraint, "reference_table") and constraint.reference_table:
                    tables_to_load.add(constraint.reference_table)
        return tables_to_load

    def load_data_sources(
        self,
        data_directory: str,
        table_filter: Optional[Union[str, list[str]]] = None,
    ) -> tuple[dict[str, pd.DataFrame], list[dict]]:
        """
        @methoddesc 批量加载数据文件

        按照 Schema 定义，解析并加载所有需要的数据文件。
        支持同一 Excel 文件多 Sheet 的批量加载优化。

        参数:
            data_directory: 数据文件所在目录
            table_filter: 表过滤条件，只加载指定表及其外键关联表

        返回:
            (原始数据集字典, 加载错误列表) 元组
        """
        raw_datasets: dict[str, pd.DataFrame] = {}
        loading_errors: list[dict] = []

        # Step 1: 解析实际搜索目录
        search_directory = self._resolve_search_directory(data_directory)

        # 检查目录是否存在
        if not os.path.isdir(search_directory):
            loading_errors.append(
                {
                    "error_type": "DirectoryNotFound",
                    "message": f"数据目录不存在: {data_directory}",
                    "source_path": data_directory,
                }
            )
            return {}, loading_errors

        # Step 2: 处理表过滤条件
        filter_set: Optional[set] = None
        if table_filter:
            if isinstance(table_filter, str):
                filter_set = {table_filter}
            else:
                filter_set = set(table_filter)

        # 收集需要加载的表（含外键关联表）
        tables_to_load: Optional[set] = None
        if filter_set:
            tables_to_load = self._collect_foreign_key_tables(filter_set)

        # Step 3: 按文件路径分组 Schema（同一文件多个 Sheet 合并加载）
        file_to_schemas: dict[str, list[DataSourceInfo]] = defaultdict(list)
        file_to_sheet_names: dict[str, str] = {}

        for table_id, table_schema in self.dataset_schema.tables.items():
            schema_file = self._schema_by_id.get(table_id)
            if not schema_file:
                continue

            # 应用表过滤
            if tables_to_load:
                table_name = table_schema.name or table_id
                if table_name not in tables_to_load and table_id not in tables_to_load:
                    continue

            # 解析数据源路径
            source_path, sheet_name = self._resolver.resolve_source_path(data_directory, schema_file)
            if not source_path:
                loading_errors.append(
                    {
                        "error_type": "SourceNotFound",
                        "message": f"表 '{table_schema.name}' 未找到数据源（已查找目录: {search_directory}）",
                        "table": table_schema.name,
                    }
                )
                continue

            # 按文件路径分组，同一文件的不同 Sheet 放在一起加载
            # 使用 DataSourceInfo DTO 将 domain TableSchema 转换为 core 层可用的最小信息
            # 使用 getattr 以兼容测试中的 MockTableSchema 等不完整对象
            file_to_schemas[source_path].append(
                DataSourceInfo(
                    schema_id=table_id,
                    name=getattr(table_schema, "name", table_id),
                    sheet_name=getattr(table_schema, "sheet_name", None),
                    header_row=getattr(table_schema, "header_row", 0),
                    source_config=getattr(table_schema, "source_config", None) or {},
                )
            )
            if sheet_name:
                file_to_sheet_names[source_path] = sheet_name

        # Step 4: 批量加载分组后的数据文件
        loaded_data, load_errors = load_grouped_sources(
            file_to_schemas,
            default_encoding=self.settings.file_processing.default_encoding,
            csv_delimiter=self.settings.file_processing.csv_delimiter,
            file_to_sheet_names=file_to_sheet_names if file_to_sheet_names else None,
        )
        raw_datasets.update(loaded_data)
        loading_errors.extend(load_errors)

        return raw_datasets, loading_errors
