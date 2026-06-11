"""
@fileoverview 数据 Schema 模型模块

功能概述:
- 定义数据集的结构（表、字段、约束）
- 提供从配置文件构建 Schema 实例的工厂函数
- 管理类型注册表（TYPE_REGISTRY）和约束注册表（CONSTRAINT_REGISTRY）

架构设计:
- 类型注册表: 将配置中的类型名称映射到 Python 类型对象
- 约束注册表: 将配置中的约束名称映射到约束类
- 工厂函数: build_type_from_config 根据配置递归构建 DataType 实例

输入示例:
    from app.shared.domain.dataset_schema import DataSetSchema, TableSchema, ColumnSchema

    col1 = ColumnSchema(name="user_id", data_type=IntegerType(), is_primary_key=True)
    table = TableSchema(name="users", columns=[col1, col2], source_file="data/users.xlsx")
    schema = DataSetSchema(tables={"users": table}, constraints=[])

输出示例:
    schema: 完整的数据集 Schema 对象，可用于驱动 process_dataframe 和约束校验
"""

from typing import Any

# 1. 项目内部导入
from app.shared.domain.data_types import (
    BooleanType,
    CompositeConditionType,
    DataType,
    DateType,
    DecimalType,
    ExpressionType,
    ExtractedType,
    FloatType,
    IntegerType,
    JsonArrayType,
    JsonNullType,
    JsonObjectType,
    SequenceType,
    StringType,
)
from app.shared.domain.constraints.base import Constraint

# ============================================================================
# 类型注册表
# ============================================================================
# 将配置中的类型名称映射到 Python 类型对象
# 使用示例：
#   "int" -> IntegerType()
#   "string" -> StringType()
#   "Expr" -> ExpressionType (类，非实例)

TYPE_REGISTRY: dict[str, Any] = {
    "Int": IntegerType(),
    "Str": StringType(),
    "Float": FloatType(),
    "Decimal": DecimalType(),
    "Boolean": BooleanType(),
    "Date": DateType(),
    "int": IntegerType(),
    "integer": IntegerType(),
    "string": StringType(),
    "str": StringType(),
    "float": FloatType(),
    "decimal": DecimalType(),
    "boolean": BooleanType(),
    "bool": BooleanType(),
    "date": DateType(),
    "Expr": ExpressionType,
    "CompositeExpr": CompositeConditionType,
    "Sequence": SequenceType,
    "Extracted": ExtractedType,
    "JsonObject": JsonObjectType(),
    "json_object": JsonObjectType(),
    "JsonArray": JsonArrayType(),
    "json_array": JsonArrayType(),
    "JsonNull": JsonNullType(),
    "json_null": JsonNullType(),
}


class ColumnSchema:
    """
    字段 Schema 定义。

    ============================================================================
    配置文件示例 (这个类对应哪种配置)
    ============================================================================
    本类对应 *.schema.yaml 中的 columns 列表项：

    ```yaml
    columns:
      - id: user_id
        name: user_id
        type: int
        primary_key: true
        expand: false

      - id: email
        name: email
        type: string
        primary_key: false
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 | 示例值 |
    |----------|------------|---------|------|-------|
    | id | (自动生成) | str | 列 ID | "user_id" |
    | name | name | str | 列名 | "user_id" |
    | type | data_type | DataType | 数据类型 | IntegerType() |
    | primary_key | is_primary_key | bool | 是否主键 | true |
    | expand | expand | bool | 是否展开 | false |

    ============================================================================
    业务场景 (什么情况下会使用这个类)
    ============================================================================
    - 场景1: 定义表的列结构
      创建表时定义每一列的名称、类型、是否主键等。

    - 场景2: 数据校验
      根据 ColumnSchema 对数据列进行类型验证。

    ============================================================================
    使用示例
    ============================================================================
    【创建实例】
    ```python
    from app.shared.domain.dataset_schema import ColumnSchema
    from app.shared.domain.data_types import IntegerType, StringType

    col = ColumnSchema(
        name="user_id",
        data_type=IntegerType(),
        is_primary_key=True,
        expand=False
    )
    ```

    【从配置创建】
    ```python
    config = {"name": "user_id", "type": "int", "primary_key": True}
    data_type = build_type_from_config(config["type"])
    col = ColumnSchema(name=config["name"], data_type=data_type)
    ```
    """

    def __init__(
        self,
        name: str,
        data_type: DataType,
        is_primary_key: bool = False,
        expand: bool = False,
        nullable: bool = True,
        id: str | None = None,
        json_path: str | None = None,
        children: list["ColumnSchema"] | None = None,
    ):
        self.name = name
        self.data_type = data_type
        self.is_primary_key = is_primary_key
        self.expand = expand
        self.nullable = nullable
        self.id = id
        self.json_path = json_path
        self.children = children


class TableSchema:
    """
    表 Schema 定义。

    ============================================================================
    配置文件示例 (这个类对应哪种配置)
    ============================================================================
    本类对应 *.schema.yaml 文件的主体：

    ```yaml
    id: users
    name: users
    source:
      mode: relative_file
      path: data/users.xlsx
      sheet: Sheet1
      header_row: 0
    columns:
      - name: user_id
        type: int
        primary_key: true
      - name: email
        type: string
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 | 示例值 |
    |----------|------------|---------|------|-------|
    | id | (表名) | str | 表 ID | "users" |
    | name | name | str | 表名 | "users" |
    | source.path | source_file | str | 数据文件路径 | "data/users.xlsx" |
    | source.sheet | sheet_name | str | Excel sheet | "Sheet1" |
    | source.header_row | header_row | int | 表头行 | 0 |
    | columns | columns | Dict[str, ColumnSchema] | 列定义字典 | {"user_id": ColumnSchema(...)} |

    ============================================================================
    业务场景 (什么情况下会使用这个类)
    ============================================================================
    - 场景1: 定义单张表的结构
      定义表的名称、列定义、数据源位置等。

    - 场景2: 加载数据文件
      根据 TableSchema 的 source_file、sheet_name 等信息加载数据。

    ============================================================================
    使用示例
    ============================================================================
    【创建实例】
    ```python
    from app.shared.domain.dataset_schema import TableSchema, ColumnSchema
    from app.shared.domain.data_types import IntegerType, StringType

    table = TableSchema(
        name="users",
        columns=[
            ColumnSchema(name="user_id", data_type=IntegerType(), is_primary_key=True),
            ColumnSchema(name="email", data_type=StringType())
        ],
        source_file="data/users.xlsx",
        sheet_name="Sheet1"
    )

    # 访问列
    col = table.get_column("user_id")
    print(col.is_primary_key)  # True
    ```
    """

    def __init__(
        self,
        id: str = None,
        name: str = None,
        columns: list[ColumnSchema] = None,
        source_file: str = None,
        sheet_name: str = None,
        header_row: int = 0,
        script_checks: list[dict] = None,
        source_config: dict[str, Any] = None,
    ):
        self.id = id
        self.name = name
        self.columns: dict[str, ColumnSchema] = {col.name: col for col in columns}
        self.source_file = source_file
        self.sheet_name = sheet_name
        self.header_row = header_row
        self.script_checks = script_checks or []
        self.source_config = source_config or {}

    def get_column(self, name: str) -> ColumnSchema:
        """
        @methoddesc 根据列名获取列定义

        参数:
            name: 列名

        返回:
            ColumnSchema 实例，如果列不存在则返回 None
        """
        return self.columns.get(name)


class DataSetSchema:
    """
    数据集 Schema 定义。

    ============================================================================
    配置文件示例 (这个类对应哪种配置)
    ============================================================================
    本类是整个数据集的顶层结构：

    ```yaml
    # 表定义
    tables:
      users:
        name: users
        columns:
          - name: user_id
            type: int
          - name: email
            type: string
      orders:
        name: orders
        columns:
          - name: order_id
            type: int

    # 约束定义（独立文件）
    constraints:
      - type: Unique
        table: users
        column: email
      - type: ForeignKey
        from_table: orders
        from_column: user_id
        to_table: users
        to_column: user_id
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | 概念 | Python 属性 | 数据类型 | 说明 |
    |------|------------|---------|------|
    | 多个表 | tables | Dict[str, TableSchema] | 表名 -> 表定义 |
    | 约束列表 | constraints | List[Constraint] | 全局约束列表 |

    ============================================================================
    业务场景 (什么情况下会使用这个类)
    ============================================================================
    - 场景1: 定义完整的数据集结构
      包含多张表及其之间的约束关系。

    - 场景2: 执行完整校验
      DataSetSchema 是 validate_full_dataset 的核心输入。

    ============================================================================
    使用示例
    ============================================================================
    【创建实例】
    ```python
    from app.shared.domain.dataset_schema import DataSetSchema, TableSchema, ColumnSchema
    from app.shared.domain.data_types import IntegerType, StringType
    from app.shared.domain.validation_constraints import UniqueConstraint

    # 创建表
    users_table = TableSchema(
        name="users",
        columns=[
            ColumnSchema(name="user_id", data_type=IntegerType()),
            ColumnSchema(name="email", data_type=StringType())
        ]
    )

    orders_table = TableSchema(
        name="orders",
        columns=[
            ColumnSchema(name="order_id", data_type=IntegerType()),
            ColumnSchema(name="user_id", data_type=IntegerType())
        ]
    )

    # 创建约束
    constraints = [
        UniqueConstraint(table="users", column="email")
    ]

    # 创建数据集 Schema
    schema = DataSetSchema(
        tables={"users": users_table, "orders": orders_table},
        constraints=constraints
    )

    # 访问
    print(schema.tables.keys())  # dict_keys(['users', 'orders'])
    print(len(schema.constraints))  # 1
    ```
    """

    def __init__(self, tables: dict[str, TableSchema], constraints: list[Constraint]):
        self.tables = tables
        self.constraints = constraints
