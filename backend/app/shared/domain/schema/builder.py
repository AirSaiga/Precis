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
    SequenceType,
    StringType,
)
from app.shared.domain.expression_system import (
    ExpressionRegistry,
)
from app.shared.domain.validation_constraints import (
    AllowedValuesConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    UniqueConstraint,
)

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
}


# ============================================================================
# 约束注册表
# ============================================================================
# 将配置中的约束名称映射到约束类
# 使用示例：
#   "Unique" -> UniqueConstraint 类
#   "ForeignKey" -> ForeignKeyConstraints 类

CONSTRAINT_REGISTRY: dict[str, Any] = {
    "Unique": UniqueConstraint,
    "ForeignKey": ForeignKeyConstraints,
    "NotNull": NotNullConstraint,
    "AllowedValues": AllowedValuesConstraint,
}


def build_type_from_config(config: Any, registries: dict[str, ExpressionRegistry] = None) -> DataType:
    """
    从配置构建数据类型实例。

    ============================================================================
    配置文件示例 (本函数处理的配置文件长这样)
    ============================================================================
    本函数处理以下格式的类型配置：

    ```yaml
    # 方式1: 字符串形式（简单类型）
    column:
      type: "int"  # 或 "string", "float", "decimal"

    # 方式2: 字典形式（带参数的类型）
    column:
      type:
        name: "Sequence"                    # 类型名称
        item_type: "string"                # 元素类型
        delimiter: ","                      # 分隔符

    # 方式3: 字典形式（带表达式的类型）
    column:
      type:
        name: "Expr"                      # 表达式类型
        registry: "patterns"               # 注册表名称
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 从配置文件加载 Schema 时
      读取 *.schema.yaml 文件后，需要将配置中的类型字符串转换为实际的类型对象。

    - 场景2: 运行时动态创建类型
      根据用户输入动态创建数据类型实例。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - config: Any，类型配置
        示例值: "int" 或 {"name": "Sequence", "item_type": "string", "delimiter": ","}
      - registries: Dict[str, ExpressionRegistry]，表达式注册表（可选）
        示例值: {"patterns": ExpressionRegistry(...)}

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 判断配置类型                                    │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: config                                           │
      │ 操作: 检查是字符串还是字典                              │
      │ 输出: 配置类型                                          │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┤
      │ Step 2: 字符串形式处理                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: config = "int"                                    │
      │ 操作: 从 TYPE_REGISTRY 查找类型                         │
      │ 输出: IntegerType() 实例                               │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┤
      │ Step 3: 字典形式处理                                    │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: config = {"name": "Sequence", ...}                │
      │ 操作: 提取 name，从 REGISTRY 查找类                     │
      │       递归处理 item_type、registry 参数                 │
      │ 输出: SequenceType(StringType(), ",") 实例             │
      └─────────────────────────────────────────────────────────────┘

    最终输出: DataType 实例
      示例:
        build_type_from_config("int")  # 返回 IntegerType() 实例
        build_type_from_config({"name": "Sequence", "item_type": "string"})
        # 返回 SequenceType(StringType(), ";")

    ============================================================================
    边界情况处理
    ============================================================================
    - 未知类型名称: 抛出 ValueError
    - 无效的配置格式: 抛出 TypeError
    - 缺失的 registry: 抛出 ValueError

    :param config: 类型配置（字符串或字典）
    :param registries: 表达式注册表字典
    :return: DataType 实例
    :raises ValueError: 类型名称不存在或 registry 缺失
    :raises TypeError: 配置格式无效
    """
    if isinstance(config, str):
        type_name = config
        if type_name not in TYPE_REGISTRY:
            raise ValueError(f"未知的类型名称: '{type_name}'")
        return TYPE_REGISTRY[type_name]

    elif isinstance(config, dict):
        type_name = config.get("name")
        if not type_name or type_name not in TYPE_REGISTRY:
            raise ValueError(f"类型配置字典中缺少或包含未知的类型名称: {config}")

        type_class = TYPE_REGISTRY[type_name]
        params = config.copy()
        params.pop("name")

        if "item_type" in params:
            params["item_type"] = build_type_from_config(params["item_type"], registries)

        if "registry" in params and isinstance(params["registry"], str):
            registry_name = params["registry"]
            if registries and registry_name in registries:
                params["registry"] = registries[registry_name]
            else:
                raise ValueError(f"名为 '{registry_name}' 的表达式注册中心未提供。")

        if "atomic_registry" in params and isinstance(params["atomic_registry"], str):
            registry_name = params["atomic_registry"]
            if registries and registry_name in registries:
                params["registry"] = registries[registry_name]
            else:
                raise ValueError(f"名为 '{registry_name}' 的表达式注册中心未提供。")

        return type_class(**params)

    else:
        raise TypeError(f"无效的类型配置格式: {type(config)}")
