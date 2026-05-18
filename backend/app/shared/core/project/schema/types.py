"""
@fileoverview Schema 类型统一导出模块

功能概述:
- 聚合导出 Schema 相关核心类型（列定义、表结构、数据源等）
- 提供 V2 版本别名及 Schema ID 编解码工具函数

架构设计:
- 聚合导出模式: 将 types_parts 中分散的类型集中暴露
- 版本别名: ColumnSpecV2、TableSchemaFileV2 等映射降低迁移成本
- 工具函数导出: encode_schema_raw_id、decode_schema_id 等直接暴露

输入示例:
    from app.shared.core.project.schema.types import TableSchemaFileV2, ColumnSpec, SourceSpec

输出示例:
    schema = TableSchemaFileV2(id="users", name="用户表", columns=[ColumnSpec(...)])
"""

from __future__ import annotations

from app.shared.core.project.schema.types_parts.column import ColumnSpec, ExtractedSpec
from app.shared.core.project.schema.types_parts.constraint import ConstraintItem
from app.shared.core.project.schema.types_parts.schema_id import (
    SCHEMA_ID_PREFIX,
    SCHEMA_ID_SECRET,
    SCHEMA_SOURCE_ROOT_TEST,
    build_schema_raw_id,
    decode_schema_id,
    encode_schema_raw_id,
    extract_sheet_from_id,
    generate_schema_id,
    is_excel_schema,
)
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
    "SCHEMA_ID_PREFIX",
    "SCHEMA_ID_SECRET",
    "SCHEMA_SOURCE_ROOT_TEST",
    "encode_schema_raw_id",
    "decode_schema_id",
    "build_schema_raw_id",
    "generate_schema_id",
    "extract_sheet_from_id",
    "is_excel_schema",
]
