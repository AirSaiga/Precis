"""
@fileoverview 运行时数据结构构建模块

功能概述:
- 将文件格式的 Schema (TableSchemaFile) 转换为运行时对象 (TableSchema)
- 将列类型配置转换为具体的 DataType 对象
- 构建约束的运行时表示

架构设计:
- 类型转换层: config -> domain object
- 利用 registries 解析表达式类型

输入示例:
    # schema_files 输入
    {
        "users": TableSchemaFile(
            id="users",
            name="用户表",
            columns=[
                Column(id="id", name="id", type="integer", primary_key=True),
                Column(id="username", name="username", type="string", nullable=False),
                Column(id="email", name="email", type="string", nullable=True)
            ],
            source=Source(path="data/users.xlsx", sheet="Sheet1", header_row=0)
        )
    }

    # registries 输入
    {
        "expression_registry": ExpressionRegistry(...)
    }

输出示例:
    # runtime_tables 输出
    {
        "users": TableSchema(
            id="users",
            name="用户表",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType(), is_primary_key=True),
                ColumnSchema(name="username", data_type=StringType(), is_primary_key=False),
                ColumnSchema(name="email", data_type=StringType(), is_primary_key=False)
            ],
            source_file="data/users.xlsx",
            sheet_name="Sheet1",
            header_row=0
        )
    }
"""

from __future__ import annotations

from typing import Any

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import TableSchemaFile


def build_runtime_schemas(schema_files: dict[str, TableSchemaFile], registries: dict[str, Any]) -> dict[str, object]:
    """@methoddesc 构建运行时 Schema 对象

    将文件格式的 TableSchemaFile 转换为运行时 TableSchema 对象。
    核心转换:
    1. 列类型: "integer" -> IntegerType() / "string" -> StringType()
    2. 数据源: source.path -> source_file, source.sheet -> sheet_name
    3. 主键: column.primary_key -> ColumnSchema.is_primary_key

    输入示例:
        schema_files = {
            "users": TableSchemaFile(
                id="users",
                name="用户表",
                columns=[
                    Column(id="col_1", name="id", type="integer", primary_key=True),
                    Column(id="col_2", name="username", type="string", nullable=False)
                ],
                source=Source(path="data/users.xlsx", sheet="Sheet1", header_row=0)
            )
        }
        registries = {"expression_registry": ExpressionRegistry(...)}

    输出示例:
        runtime_tables = {
            "users": TableSchema(
                id="users",
                name="用户表",
                columns=[
                    ColumnSchema(name="id", data_type=IntegerType(), is_primary_key=True, expand=False),
                    ColumnSchema(name="username", data_type=StringType(), is_primary_key=False, expand=False)
                ],
                source_file="data/users.xlsx",
                sheet_name="Sheet1",
                header_row=0,
                script_checks=[]
            )
        }

    原理说明:
        - type 字段可能是简单类型 (integer, string) 或复杂类型 (expression, extracted)
        - build_type_from_config() 函数负责解析类型字符串或字典，生成对应的 DataType 对象
        - 如果 schema 没有 source 但有 id，则从 id 推断 sheet_name (向后兼容旧格式)
    """
    from app.shared.core.project.schema.types import extract_sheet_from_id
    from app.shared.domain import ColumnSchema, TableSchema, build_type_from_config

    # 用于存储转换后的运行时表对象，键为表 ID
    runtime_tables: dict[str, object] = {}
    # 逐个处理每个 Schema 文件
    for schema in schema_files.values():
        # 构建该表的所有列定义
        columns = []
        for col in schema.columns or []:
            # 将字符串类型的列配置（如 "integer"）转换为对应的 DataType 对象
            data_type = build_type_from_config(col.type, registries)
            # 创建运行时的列 Schema 对象
            columns.append(
                ColumnSchema(
                    name=col.name,
                    data_type=data_type,
                    is_primary_key=col.primary_key,
                    expand=col.expand,
                    nullable=col.nullable,
                    id=col.id,
                    json_path=col.json_path,
                )
            )

        # 初始化数据源相关变量
        source_file = None
        sheet_name = None
        header_row = 0
        source_config: dict[str, Any] = {}
        # 如果 Schema 中定义了 source 字段，则提取数据源配置
        if schema.source:
            source_file = schema.source.path
            sheet_name = schema.source.sheet
            header_row = schema.source.header_row
            source_config["mode"] = schema.source.mode
            if schema.source.options:
                source_config["options"] = schema.source.options.model_dump()
        else:
            # 当 source 为空时，优先使用顶层 sheet 字段作为回退
            if schema.sheet:
                sheet_name = schema.sheet
            elif schema.id:
                # 向后兼容：从表 ID 推断 sheet 名称
                sheet_name = extract_sheet_from_id(schema.id)

        # 构建运行时的 TableSchema 对象
        table = TableSchema(
            name=schema.name,
            columns=columns,
            source_file=source_file,
            sheet_name=sheet_name,
            header_row=header_row,
            script_checks=schema.script_checks,
            source_config=source_config,
        )
        # 动态设置表对象的 id 属性（与 schema.id 保持一致）
        setattr(table, "id", schema.id)
        # 将表对象存入结果字典
        runtime_tables[schema.id] = table

    # 返回所有运行时表对象
    return runtime_tables


def build_runtime_constraints(constraint_files: dict[str, ConstraintFile], schema_files: dict[str, TableSchemaFile]):
    """@methoddesc 构建运行时约束对象（代理函数）

    该函数是约束工厂模块 create_constraints 的薄包装，
    负责将 ConstraintFile 配置批量转换为运行时约束实例。

    输入示例:
        constraint_files = {
            "unique_email": ConstraintFile(
                id="unique_email",
                type="Unique",
                refs={"table_id": "users", "column_ids": ["email"]}
            )
        }
        schema_files = {"users": TableSchemaFile(...)}

    输出示例:
        ([UniqueConstraint(...)], [])  # (约束实例列表, 警告列表)
    """
    # 导入并委托给 constraint.factory 完成实际的约束实例化
    from app.shared.core.project.constraint.factory import create_constraints

    return create_constraints(constraint_files, schema_files)


# ============================================================================
# Patterns 注册表构建（原 registries.py，合并至此以减少碎片化文件）
# ============================================================================

from pathlib import Path

from app.shared.core.patterns.loader import load_patterns_from_config
from app.shared.core.project.loader.loader_parts.path_validation import validate_path_inside_project


def build_registries(project_root: Path, manifest: object) -> dict[str, Any]:
    """@methoddesc 构建 Patterns 注册表

    从 manifest.patterns_dir 指定的目录加载表达式模式。

    输入示例:
        project_root = Path("/path/to/project")
        manifest = Manifest(
            version="2",
            patterns_dir="patterns",
            schemas=[...],
            constraints=[...]
        )

        # patterns 目录内容:
        # patterns/
        #   └── math.yaml
        #       ---
        #       - name: add
        #         pattern: "{a} + {b}"
        #         returns: integer

    输出示例:
        registries = {
            "expression_registry": ExpressionRegistry(
                patterns={
                    "math": [
                        Pattern(name="add", pattern="{a} + {b}", returns="integer")
                    ]
                }
            )
        }

    原理说明:
        - load_patterns_from_config() 会递归扫描 patterns_dir 下所有 .yaml 文件
        - 每个文件对应一个命名空间 (namespace)
        - 表达式在验证时可以通过 namespace.name 引用
    """
    # 根据 manifest 中配置的 patterns_dir 计算绝对路径
    patterns_dir = project_root / manifest.patterns_dir
    registries: dict[str, Any] = {}
    # 验证 patterns 目录是否在项目根目录范围内，防止目录遍历
    try:
        validate_path_inside_project(project_root, patterns_dir, "patterns 目录")
    except ValueError:
        # 如果路径验证失败，返回空的表达式注册表，避免阻塞后续加载
        return {"expression_registry": None}
    # 目录存在时加载所有模式文件；不存在则返回 None
    if patterns_dir.exists():
        registries["expression_registry"] = load_patterns_from_config(str(patterns_dir))
    else:
        registries["expression_registry"] = None
    return registries
