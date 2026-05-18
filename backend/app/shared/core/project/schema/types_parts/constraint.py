"""
@fileoverview 约束项类型定义模块

功能概述:
- 定义 Schema 文件中的内嵌约束 (ConstraintItem)
- 支持多种约束类型: NotNull, Unique, AllowedValues, ForeignKey 等

架构设计:
- 统一模型: 所有约束类型使用同一个模型
- 字段可选: 根据约束类型不同，需要填写不同字段
- 简化写法: 支持 column 简写和 columns 列表

输入示例 (schema.yaml):
    constraints:
      # 非空约束 (简化写法)
      - id: not_null_email
        type: NotNull
        column: email

      # 允许值约束
      - id: status_allowed
        type: AllowedValues
        column: status
        params:
          allowed_values:
            - active
            - inactive
            - pending

      # 外键约束
      - id: fk_orders
        type: ForeignKey
        from_column: user_id
        to_table: users
        to_column: id

输出示例:
    ConstraintItem(
        id="not_null_email",
        type="NotNull",
        enabled=True,
        column="email"
    )
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ConstraintItem(BaseModel):
    """@classdesc 内嵌约束项

    在 Schema 文件中直接定义的约束。

    字段说明:
        - id: 约束 ID (表内唯一)
        - type: 约束类型
            - NotNull: 非空约束
            - Unique: 唯一性约束
            - AllowedValues: 允许值约束
            - ForeignKey: 外键约束
            - Conditional: 条件约束
            - Scripted: 脚本约束
            - Range: 范围约束
            - Charset: 字符集约束
            - DateLogic: 日期逻辑约束
        - enabled: 是否启用
        - description: 约束描述 (可选)

        # 列级约束 (二选一)
        - column: 目标列名 (单列)
        - columns: 目标列名列表 (多列，如联合唯一键)

        # 外键约束 (仅 ForeignKey 类型)
        - from_table: 源表名
        - from_column: 源列名
        - to_table: 目标表名
        - to_column: 目标列名

        # 通用参数
        - params: 约束参数 (如 AllowedValues 的 allowed_values 列表)

    输入示例 (schema.yaml):
        constraints:
          # 非空约束 (简化写法)
          - id: not_null_email
            type: NotNull
            column: email

          # 允许值约束
          - id: status_allowed
            type: AllowedValues
            column: status
            params:
              allowed_values:
                - active
                - inactive
                - pending

          # 外键约束
          - id: fk_orders
            type: ForeignKey
            from_column: user_id
            to_table: users
            to_column: id

    输出示例:
        ConstraintItem(
            id="not_null_email",
            type="NotNull",
            enabled=True,
            column="email"
        )
    """

    id: str = Field(..., description="约束 ID（同一表内必须唯一）")
    type: Literal[
        "NotNull",
        "Unique",
        "AllowedValues",
        "ForeignKey",
        "Conditional",
        "Scripted",
        "Range",
        "Charset",
        "DateLogic",
    ] = Field(..., description="约束类型")
    enabled: bool = Field(True, description="是否启用")
    description: str | None = Field(None, description="约束描述")

    column: str | None = Field(None, description="目标列名（简化写法）")
    columns: list[str] | None = Field(None, description="目标列名列表（多列约束）")

    from_table: str | None = Field(None, description="外键源表名")
    from_column: str | None = Field(None, description="外键源列名")
    to_table: str | None = Field(None, description="外键目标表名")
    to_column: str | None = Field(None, description="外键目标列名")

    params: dict[str, Any] = Field(default_factory=dict, description="约束参数（如 allowed_values 等）")
