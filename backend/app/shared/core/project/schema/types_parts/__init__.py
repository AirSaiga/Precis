"""
@fileoverview Schema 子类型聚合导出模块

功能概述:
- 集中导出 Schema 各组成部分的类型定义与工具函数
- 提供列定义、表结构、数据源、约束项及 Schema ID 工具

架构设计:
- 扁平化导出: 将 schema_id 工具函数与类型统一暴露
- 显式接口控制: 通过 __all__ 限定公开符号

输入示例:
    from app.shared.core.project.schema.types_parts import TableSchemaFile, ColumnSpec, encode_schema_raw_id

输出示例:
    schema_id = encode_schema_raw_id("users", sheet="Sheet1")
"""

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

__all__ = [
    "ColumnSpec",
    "ExtractedSpec",
    "ConstraintItem",
    "SourceSpec",
    "TableSchemaFile",
    "SCHEMA_ID_PREFIX",
    "SCHEMA_ID_SECRET",
    "SCHEMA_SOURCE_ROOT_TEST",
    "build_schema_raw_id",
    "decode_schema_id",
    "encode_schema_raw_id",
    "extract_sheet_from_id",
    "generate_schema_id",
    "is_excel_schema",
]
