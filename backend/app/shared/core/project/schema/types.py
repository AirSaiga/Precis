"""@fileoverview Schema 类型统一导出模块

功能概述:
- 聚合导出 Schema 相关核心类型（列定义、表结构、数据源等）
- 提供 V2 版本别名及 source 标准化工具函数
"""

from __future__ import annotations

from app.shared.core.project.schema.types_parts.column import ColumnSpec, ExtractedSpec
from app.shared.core.project.schema.types_parts.constraint import ConstraintItem
from app.shared.core.project.schema.types_parts.schema_id import normalize_source_key
from app.shared.core.project.schema.types_parts.source import SourceSpec
from app.shared.core.project.schema.types_parts.table import TableSchemaFile

SourceSpecV2 = SourceSpec
ColumnSpecV2 = ColumnSpec
TableSchemaFileV2 = TableSchemaFile
ConstraintItemV2 = ConstraintItem

__all__ = [
    "SourceSpec",
    "ExtractedSpec",
    "ColumnSpec",
    "ConstraintItem",
    "TableSchemaFile",
    "SourceSpecV2",
    "ColumnSpecV2",
    "TableSchemaFileV2",
    "ConstraintItemV2",
    "normalize_source_key",
]
