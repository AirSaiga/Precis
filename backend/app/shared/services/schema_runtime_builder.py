"""
@fileoverview Schema 运行时对象构建服务

功能概述:
- 将 core 层的 TableSchemaFile 配置转换为 domain 层的运行时 TableSchema 对象
- 负责 core DTO 与 domain model 之间的转换，避免 core 层直接依赖 domain

架构设计:
- 转换层: config (TableSchemaFile) -> domain (TableSchema/ColumnSchema)
- 依赖 domain 的 build_type_from_config 解析列类型
- 由 services 层（如 project_loader、validation）调用
"""

from __future__ import annotations

from typing import Any

from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain import ColumnSchema, TableSchema, build_type_from_config


def build_runtime_schema(schema_file: TableSchemaFile, registries: dict[str, Any]) -> TableSchema:
    """@methoddesc 从 TableSchemaFile 构建运行时 TableSchema 对象。

    本函数位于 services 层，负责将 core 层的配置文件对象转换为 domain 层运行时对象，
    从而消除 core.project.schema.reader 对 domain 的反向依赖。

    :param schema_file: TableSchemaFile 配置对象
    :param registries: 包含 expression_registry 的字典
    :return: 运行时 TableSchema 对象
    """
    columns: list[ColumnSchema] = []
    for col in schema_file.columns:
        data_type = build_type_from_config(col.type, registries)
        col_schema = ColumnSchema(
            name=col.name,
            data_type=data_type,
            is_primary_key=col.primary_key,
            expand=col.expand,
            nullable=col.nullable,
            id=col.id,
            json_path=col.json_path,
        )
        if col.children:
            child_columns = []
            for child in col.children:
                child_data_type = build_type_from_config(child.type, registries)
                child_columns.append(
                    ColumnSchema(
                        name=child.name,
                        data_type=child_data_type,
                        is_primary_key=child.primary_key,
                        expand=child.expand,
                        nullable=child.nullable,
                        id=child.id,
                        json_path=child.json_path,
                    )
                )
            col_schema.children = child_columns
        columns.append(col_schema)

    # 提取数据源信息
    source_file = None
    sheet_name = None
    header_row = 0
    source_config: dict[str, Any] = {}
    if schema_file.source:
        source_file = schema_file.source.path
        sheet_name = schema_file.source.sheet
        header_row = schema_file.source.header_row
        # 保存完整的 source 配置，用于数据加载
        source_config = schema_file.source.to_loader_config()
    elif schema_file.sheet:
        # 向后兼容：无 source 时回退到顶层 sheet 字段
        # （source.sheet 与顶层 sheet 互斥，但单独的顶层 sheet 是合法配置）
        sheet_name = schema_file.sheet

    # 构建运行时 TableSchema 对象
    return TableSchema(
        id=schema_file.id,
        name=schema_file.name,
        columns=columns,
        source_file=source_file,
        sheet_name=sheet_name,
        header_row=header_row,
        script_checks=schema_file.script_checks,
        source_config=source_config,
    )


def build_runtime_schemas(
    schema_files: dict[str, TableSchemaFile],
    registries: dict[str, Any],
) -> dict[str, TableSchema]:
    """@methoddesc 批量构建运行时 TableSchema 对象。

    :param schema_files: schema 文件字典（table_id -> TableSchemaFile）
    :param registries: 表达式注册表
    :return: 运行时 TableSchema 字典（table_id -> TableSchema）
    """
    tables: dict[str, TableSchema] = {}
    for table_id, schema in schema_files.items():
        # 使用 table_id 作为键，与新的文件命名规则保持一致
        tables[table_id] = build_runtime_schema(schema, registries)
    return tables
