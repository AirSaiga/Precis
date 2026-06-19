"""
@fileoverview 项目加载服务辅助模块

功能概述:
- 负责将 core 层加载的配置文件对象转换为 domain 层运行时数据集 Schema
- 作为 core 层与 domain 层之间的转换桥梁，避免 core 层反向依赖 domain

架构设计:
- 转换层: core (TableSchemaFile / ConstraintFile) -> domain (DataSetSchema)
- 由 core.project.loader 的主加载流程调用
"""

from __future__ import annotations

from typing import Any

from app.shared.core.project.constraint.factory import create_constraints
from app.shared.core.project.schema.types import TableSchemaFile
from app.shared.domain import DataSetSchema

from .schema_runtime_builder import build_runtime_schemas


def build_dataset_schema(
    schema_files: dict[str, TableSchemaFile],
    constraint_files: dict[str, Any],
    registries: dict[str, Any],
) -> tuple[DataSetSchema, list[str]]:
    """@methoddesc 构建 domain 层的 DataSetSchema 运行时对象。

    将 core 层加载的 TableSchemaFile 和 ConstraintFile 转换为 domain 层的
    TableSchema 列表和约束实例，最终组装为 DataSetSchema。

    :param schema_files: schema 配置文件字典（table_id -> TableSchemaFile）
    :param constraint_files: constraint 配置文件字典（constraint_id -> ConstraintFile）
    :param registries: 表达式注册表等辅助对象
    :return: (DataSetSchema, 约束构建过程中的警告列表)
    """
    runtime_tables = build_runtime_schemas(schema_files, registries)
    runtime_constraints, warnings = create_constraints(constraint_files, schema_files)
    dataset_schema = DataSetSchema(tables=runtime_tables, constraints=runtime_constraints)
    return dataset_schema, warnings
