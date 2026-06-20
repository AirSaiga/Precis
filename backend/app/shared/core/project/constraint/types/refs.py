"""
@fileoverview 约束规则配置模块

功能概述:
- 定义 V2 约束规则的数据类型（使用 Pydantic BaseModel）
- 定义各种约束类型的引用结构（Refs）
- 提供约束配置文件的数据模型

架构设计:
- 类型定义层: Constraint 系统的核心数据模型层
- 分离设计: refs（引用区）定义约束目标，params（参数区）定义约束参数
- Pydantic 验证: 使用 BaseModel 进行数据验证和序列化

输入示例:
    refs = UniqueRefs(table_id="users", column_ids=["email"])
    constraint = ConstraintFile(
        version=2,
        id="unique_email",
        type="Unique",
        refs=refs,
        params={},
    )

输出示例:
    yaml_data = constraint.model_dump(exclude_none=True)
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class UniqueRefs(BaseModel):
    """
    @classdesc 唯一性约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 Unique 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - Unique 约束示例
    refs:
      table_id: users           # 目标表的 ID
      column_ids: [email]      # 目标列 ID 列表（单列）
    # 或多列组合唯一：
    refs:
      table_id: orders
      column_ids: [user_id, order_date]  # 组合唯一
    ```

    ============================================================================
    字段映射说明 (YAML 如何变成 Python 对象)
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 | 示例值 |
    |----------|------------|---------|------|-------|
    | table_id | table_id | str | 目标表的 ID | "users" |
    | column_ids | column_ids | List[str] | 目标列 ID 列表 | ["email"] |

    ============================================================================
    业务场景 (这个类在什么地方被使用)
    ============================================================================
    - 场景1: 确保邮箱唯一
      约束类型为 Unique，refs 指定表和列，系统校验时检查该列是否有重复值。

    - 场景2: 组合唯一
      如订单表中 (user_id, order_date) 组合必须唯一。

    ============================================================================
    使用示例
    ============================================================================
    【创建实例】
    ```python
    from app.shared.core.project.constraint.types import UniqueRefs

    refs = UniqueRefs(
        table_id="users",
        column_ids=["email"]
    )
    ```
    """

    # 目标表的 ID（对应 schema 文件中的 table.id）
    table_id: str
    # 目标列 ID 列表（对应 schema 文件中的 column.id）
    # 多列组合表示这些列的组合值必须唯一
    column_ids: list[str]


class NotNullRefs(BaseModel):
    """
    @classdesc 非空约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 NotNull 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - NotNull 约束示例
    refs:
      table_id: users           # 目标表的 ID
      column_id: email         # 目标列 ID
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 |
    |----------|------------|---------|------|
    | table_id | table_id | str | 目标表的 ID |
    | column_id | column_id | str | 目标列 ID |

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 确保必填字段有值
      用户注册时，邮箱和手机号必须填写，不能为空。

    :param table_id: 目标表的 ID
    :param column_id: 目标列 ID
    """

    # 目标表的 ID
    table_id: str
    # 目标列 ID
    column_id: str


class AllowedValuesRefs(BaseModel):
    """
    @classdesc 允许值约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 AllowedValues 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - AllowedValues 约束示例
    refs:
      table_id: users           # 目标表的 ID
      column_id: gender         # 目标列 ID
    params:
      allowed_values: [男, 女, 未知]  # 允许值列表（在 params 中）
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 限制枚举值
      性别字段只能是"男"、"女"、"未知"。

    :param table_id: 目标表的 ID
    :param column_id: 目标列 ID
    """

    # 目标表的 ID
    table_id: str
    # 目标列 ID
    column_id: str


class ForeignKeyRefs(BaseModel):
    """
    @classdesc 外键约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 ForeignKey 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - ForeignKey 约束示例
    refs:
      from_table_id: orders       # 源表 ID（包含外键的表）
      from_column_id: user_id     # 源列 ID（外键列）
      to_table_id: users          # 目标表 ID（被参照的表）
      to_column_id: user_id       # 目标列 ID（被参照的列，通常为主键）
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 订单关联用户
      订单表中的 user_id 必须在用户表中存在。

    :param from_table_id: 源表 ID
    :param from_column_id: 源列 ID
    :param to_table_id: 目标表 ID
    :param to_column_id: 目标列 ID
    """

    # 源表 ID（包含外键的表）
    from_table_id: str
    # 源列 ID（外键列）
    from_column_id: str
    # 目标表 ID（被参照的表）
    to_table_id: str
    # 目标列 ID（被参照的列，通常为主键）
    to_column_id: str


class ConditionalIfCondition(BaseModel):
    """
    @classdesc 条件约束的 IF 条件结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 Conditional 约束的 if 条件：

    ```yaml
    # *.constraint.yaml - Conditional 约束示例
    refs:
      table_id: users
      then_column_id: status
      if_conditions:
        - if_column_id: age
          operator: ">"
          value: 18
      if_logic: and
    params:
      then_value: "成人"
    ```

    ============================================================================
    字段映射说明
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 |
    |----------|------------|---------|------|
    | if_column_id | if_column_id | str | 条件判断依据的列 ID |
    | operator | operator | str | 比较运算符 |
    | value | value | Any | 单值比较时的值 |
    | values | values | Optional[List[Any]] | 多值比较时的值列表 |

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 条件赋值
      如果年龄 > 18，则状态为"成人"。

    :param if_column_id: 条件判断依据的列 ID
    :param operator: 比较运算符
    :param value: 单值比较时的值
    :param values: 多值比较时的值列表
    """

    # 条件判断依据的列 ID
    if_column_id: str
    # 比较运算符，支持 eq/ne/in/greater_than/less_than 等
    operator: str = Field(..., description="eq/ne/in/greater_than 等")
    # 单值比较时的值
    value: Any = None
    # 多值比较时的值列表（用于 in 运算符）
    values: list[Any] | None = None


class ConditionalRefs(BaseModel):
    """
    @classdesc 条件约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 Conditional 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - Conditional 约束示例
    refs:
      table_id: users
      then_column_id: status
      if_conditions:
        - if_column_id: age
          operator: ">"
          value: 18
      if_logic: and
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 条件更新
      当满足某些条件时，对特定列应用约束规则。

    :param table_id: 目标表 ID
    :param then_column_id: 需要应用约束的列 ID
    :param if_conditions: IF 条件列表
    :param if_logic: 条件逻辑：and/or
    """

    # 目标表 ID
    table_id: str
    # THEN 部分的列 ID（需要应用约束的列）
    then_column_id: str
    # IF 条件列表（支持多个条件组合）
    if_conditions: list[ConditionalIfCondition] = Field(default_factory=list)
    # 条件逻辑：and（全部满足）/ or（任一满足）
    if_logic: Literal["and", "or"] = "and"


class ScriptedRefs(BaseModel):
    """
    @classdesc 脚本约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 Scripted 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - Scripted 约束示例
    refs:
      table_id: users
      column_id: email
    params:
      expression: "validate_email(value)"  # 脚本表达式
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 自定义验证逻辑
      使用脚本表达式进行复杂的数据验证。

    :param table_id: 目标表 ID
    :param column_id: 目标列 ID（可选，若不指定则对整行数据执行脚本）
    """

    # 目标表 ID
    table_id: str
    # 目标列 ID（可选，若不指定则对整行数据执行脚本）
    column_id: str | None = None


class RangeRefs(BaseModel):
    """
    @classdesc 区间约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 Range 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - Range 约束示例
    refs:
        table_id: products
        column_id: price
    params:
        min: 0
        max: 10000
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 数值范围校验
      商品价格必须在 0-10000 之间。

    :param table_id: 目标表 ID
    :param column_id: 目标列 ID
    """

    # 目标表 ID
    table_id: str
    # 目标列 ID
    column_id: str


class DateLogicRefs(BaseModel):
    """
    @classdesc 日期逻辑约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 DateLogic 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - DateLogic 约束示例
    refs:
        table_id: users
        column_id: birth_date
    params:
        logic_mode: compare  # compare=比较模式, calculation=计算模式
        compare_op: gt       # gt/lt/eq/gte/lte/range
        reference_date: "2000-01-01"
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 日期比较
      出生日期必须晚于 2000-01-01。

    - 场景2: 日期范围
      订单日期必须在 2024-01-01 到 2024-12-31 之间。
      此时 params 中 compare_op 为 "range"，并需要 reference_date_end / reference_column_end。

    :param table_id: 目标表 ID
    :param column_id: 目标列 ID
    """

    # 目标表 ID
    table_id: str
    # 目标列 ID
    column_id: str


class CharsetRefs(BaseModel):
    """
    @classdesc 字符集约束引用结构。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应 *.constraint.yaml 中 Charset 约束的 refs 字段：

    ```yaml
    # *.constraint.yaml - Charset 约束示例
    refs:
        table_id: users
        column_id: name
    params:
        encoding: utf-8
    ```

    ============================================================================
    业务场景
    ============================================================================
    - 场景1: 字符集检测
      检测列数据是否符合指定字符集编码。

    :param table_id: 目标表 ID
    :param column_id: 目标列 ID
    """

    # 目标表 ID
    table_id: str
    # 目标列 ID
    column_id: str
