"""
@fileoverview 表结构读取模块

功能概述:
- 从 *.schema.yaml 文件读取表结构配置
- 构建运行时 TableSchema 对象
- 支持批量加载多个表结构配置文件

架构设计:
- 单一职责: 仅负责 Schema 文件读取和运行时转换
- 依赖注入: 使用 YAML 读取工具进行文件解析
- 类型安全: 使用 Pydantic 模型验证确保配置有效

输入示例:
    # users.schema.yaml
    version: 2
    id: users
    name: users
    source:
      mode: relative_file
      path: data/users.xlsx
    columns:
      - id: user_id
        name: user_id
        type: string

输出示例:
    schema_file = load_schema("schemas/users.schema.yaml")
    runtime_schema = build_runtime_schema(schema_file, registries)
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from app.shared.core.io.yaml import read_yaml
from app.shared.domain import ColumnSchema, TableSchema, build_type_from_config

from .types import TableSchemaFile, extract_sheet_from_id

if TYPE_CHECKING:
    from .types import TableSchemaFile


def load_schema(schema_path: str | Path) -> TableSchemaFile:
    """
    @methoddesc 从 YAML 文件加载表结构配置。

    ============================================================================
    配置文件示例 (本函数处理的配置文件长这样)
    ============================================================================
    本函数处理以下格式的 *.schema.yaml 文件：

    ```yaml
    # ============================================================
    # 表结构配置文件 (*.schema.yaml)
    # ============================================================

    version: 2

    id: users

    name: users

    source:
      mode: relative_file
      path: data/users.xlsx
      sheet: Sheet1
      header_row: 0

    columns:
      - id: user_id
        name: user_id
        type: string
        primary_key: true
        expand: false
      - id: email
        name: email
        type: string
        primary_key: false

    constraints:
      - id: email_notnull
        type: NotNull
        column: email
        enabled: true

    script_checks: []
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 加载表结构进行数据校验
      系统需要读取表结构配置来获取列定义和数据源信息。

    - 场景2: 构建运行时数据模型
      需要将配置文件转换为运行时对象供校验引擎使用。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - schema_path: str | Path，schema 文件路径
        示例值: "schemas/users.schema.yaml"

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 路径标准化                                      │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 字符串或 Path 对象                                  │
      │ 操作: 转换为 Path 对象                                    │
      │ 输出: Path 对象                                          │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: YAML 解析                                       │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: Path 对象                                          │
      │ 操作: 读取 YAML 文件                                     │
      │ 输出: 字典对象                                           │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 3: Pydantic 验证                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 字典对象                                           │
      │ 操作: 验证数据结构                                       │
      │ 输出: TableSchemaFile 对象                               │
      └─────────────────────────────────────────────────────────────┘

    最终输出: TableSchemaFile 对象
      示例:
        schema = load_schema("schemas/users.schema.yaml")
        print(schema.name)  # 输出: users
        print(len(schema.columns))  # 输出: 2

    ============================================================================
    异常处理
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | ValueError | 文件不存在 | 检查文件路径 |
    | ValueError | YAML 格式错误 | 验证 YAML 文件 |
    | ValueError | 验证失败 | 检查配置格式 |

    :param schema_path: schema 文件路径
    :return: TableSchemaFile 对象
    :raises ValueError: 文件不存在或格式错误
    """
    path = Path(schema_path)
    raw = read_yaml(path)

    try:
        return TableSchemaFile.model_validate(raw)
    except ValidationError as e:
        raise ValueError(f"schema 校验失败: {path}\n{e}") from e


def build_runtime_schema(schema_file: TableSchemaFile, registries: dict[str, Any]) -> TableSchema:
    """
    @methoddesc 从 TableSchemaFile 构建运行时 TableSchema 对象。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - schema_file: TableSchemaFile，配置对象
        示例值: TableSchemaFile(id="users", name="users", columns=[...])
      - registries: Dict[str, Any]，表达式注册表
        示例值: {"expression_registry": {...}}

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 构建列定义                                      │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: schema_file.columns                                 │
      │ 操作: 遍历每列，将 type 配置转换为运行时数据类型           │
      │ 输出: ColumnSchema 列表                                   │
      │ 示例:                                                    │
      │   输入: ColumnSpec(name="email", type="string")          │
      │   处理: build_type_from_config("string", registries)      │
      │   输出: ColumnSchema(name="email", data_type=StringType)│
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 提取数据源信息                                   │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: schema_file.source                                  │
      │ 操作: 提取 path、sheet、header_row                       │
      │ 输出: source_file, sheet_name, header_row                │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 3: 构建运行时 Schema                                │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 列定义 + 数据源信息                                 │
      │ 操作: 组装 TableSchema 对象                              │
      │ 输出: TableSchema 对象                                   │
      └─────────────────────────────────────────────────────────────┘

    最终输出: TableSchema 对象
      示例:
        runtime = build_runtime_schema(schema_file, registries)
        print(runtime.name)  # 输出: users
        print(runtime.columns)  # 输出: [ColumnSchema(...), ...]

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 校验任务执行前准备
      系统执行数据校验前，需要将配置文件转换为运行时对象。

    - 场景2: 批量加载所有表结构
      调用 build_runtime_schemas 批量转换所有表配置。

    ============================================================================
    异常处理
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | KeyError | registries 缺少必要键 | 检查 registries 参数 |

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
    source_config = {}
    if schema_file.source:
        source_file = schema_file.source.path
        sheet_name = schema_file.source.sheet
        header_row = schema_file.source.header_row
        # 保存完整的 source 配置，用于数据加载
        source_config = schema_file.source.to_loader_config()
    else:
        # 如果没有显式声明 source.sheet，尝试从 ID 中提取
        # ID 格式：xlsx 为 {文件名}-{sheet名}，csv 为 {文件名}
        if schema_file.id and "-" in schema_file.id:
            sheet_name = extract_sheet_from_id(schema_file.id)

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
    """
    @methoddesc 批量构建运行时 TableSchema 对象。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - schema_files: Dict[str, TableSchemaFile]，table_id -> TableSchemaFile 映射
        示例值: {"users-Users": TableSchemaFile(...), "products": TableSchemaFile(...)}
      - registries: 表达式注册表

    处理步骤:
      遍历 schema_files，为每个 TableSchemaFile 调用 build_runtime_schema

    最终输出: Dict[str, TableSchema]，table_id -> TableSchema 映射
      示例:
        runtime_schemas = build_runtime_schemas(schema_files, registries)
        print(runtime_schemas.keys())  # dict_keys(['users-Users', 'products'])

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 项目加载时批量转换
      load_project 函数调用此方法将所有 Schema 文件转换为运行时对象。

    ============================================================================
    异常处理
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | Exception | 单个 schema 转换失败 | 继续处理其他 schema |

    :param schema_files: schema 文件字典（table_id -> TableSchemaFile）
    :param registries: 表达式注册表
    :return: 运行时 TableSchema 字典（table_id -> TableSchema）
    """
    tables: dict[str, TableSchema] = {}
    for table_id, schema in schema_files.items():
        # 使用 table_id 作为键，与新的文件命名规则保持一致
        tables[table_id] = build_runtime_schema(schema, registries)
    return tables


def schema_column_name_by_id(schema: TableSchemaFile) -> dict[str, str]:
    """
    @methoddesc 构建列 ID 到列名的映射。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - schema: TableSchemaFile 对象

    最终输出: Dict[str, str]，列 ID -> 列名 映射
      示例:
        mapping = schema_column_name_by_id(schema)
        print(mapping)  # {'user_id': 'user_id', 'email': 'email'}

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 约束引用解析
      约束中使用列 ID 引用列，需要转换为列名进行数据访问。

    :param schema: TableSchemaFile 对象
    :return: 列 ID -> 列名 的映射字典
    """
    return {c.id: c.name for c in schema.columns}


def schema_column_id_by_name(schema: TableSchemaFile) -> dict[str, str]:
    """
    @methoddesc 构建列名到列 ID 的映射。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - schema: TableSchemaFile 对象

    最终输出: Dict[str, str]，列名 -> 列 ID 映射
      示例:
        mapping = schema_column_id_by_name(schema)
        print(mapping)  # {'user_id': 'user_id', 'email': 'email'}

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: UI 展示转换
      需要将列名转换为 ID 进行内部处理。

    :param schema: TableSchemaFile 对象
    :return: 列名 -> 列 ID 的映射字典
    """
    return {c.name: c.id for c in schema.columns}
