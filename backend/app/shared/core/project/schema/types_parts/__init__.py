"""@fileoverview Schema 子类型聚合导出模块

功能概述:
- 集中导出 Schema 各组成部分的类型定义与工具函数
- 提供列定义、表结构、数据源、约束项及 source 标准化工具
"""

from app.shared.core.project.schema.types_parts.column import ColumnSpec, ExtractedSpec
from app.shared.core.project.schema.types_parts.constraint import ConstraintItem
from app.shared.core.project.schema.types_parts.schema_id import normalize_source_key
from app.shared.core.project.schema.types_parts.source import SourceSpec
from app.shared.core.project.schema.types_parts.table import TableSchemaFile

__all__ = [
    "ColumnSpec",
    "ExtractedSpec",
    "ConstraintItem",
    "SourceSpec",
    "TableSchemaFile",
    "normalize_source_key",
]
