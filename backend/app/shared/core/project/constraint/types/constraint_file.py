"""
@fileoverview 约束文件数据模型模块

功能概述:
- 定义单条约束配置文件的数据模型 (ConstraintFile)
- 映射 *.constraint.yaml 文件结构到 Python Pydantic 模型
- 支持 refs（引用区）+ params（参数区）分离设计

架构设计:
- Pydantic 模型：利用类型注解和校验确保数据一致性
- 字段映射：YAML 字段与 Python 属性一一对应
- 兼容设计：ConstraintFileV2 作为 ConstraintFile 的别名

输入示例:
    raw = read_yaml(Path("constraints/unique_email.constraint.yaml"))
    constraint = ConstraintFile.model_validate(raw)

输出示例:
    ConstraintFile(
        version=2,
        id="unique_email",
        type="Unique",
        enabled=True,
        description="邮箱必须唯一",
        refs={"table_id": "users", "column_ids": ["email"]},
        params={}
    )
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ConstraintFile(BaseModel):
    """
    @classdesc 单条约束配置文件的数据模型。

    ============================================================================
    配置文件对应关系 (这个类对应哪种配置文件)
    ============================================================================
    本类对应整个 *.constraint.yaml 文件：

    ```yaml
    # ============================================================
    # 约束规则配置文件 (*.constraint.yaml)
    # ============================================================
    # 每条约束规则对应一个独立的 constraint 文件
    # 采用分离设计：refs（引用区）+ params（参数区）

    # 配置版本号，固定为 2
    version: 2

    # 约束 ID（稳定标识）
    id: unique_user_email

    # 约束类型（对应注册表中的键）
    type: Unique

    # 是否启用该约束
    enabled: true

    # 约束描述信息
    description: "用户邮箱必须唯一"

    # 引用区：用 ID 指向表/列，定义约束作用的目标对象
    refs:
      table_id: users           # 目标表的 ID
      column_ids: [email]      # 目标列 ID 列表

    # 参数区：除引用之外的可编辑参数
    params: {}

    # --- 其他约束类型示例 ---

    # NotNull 约束
    # id: email_notnull
    # type: NotNull
    # refs:
    #   table_id: users
    #   column_id: email

    # AllowedValues 约束
    # id: gender_allowed
    # type: AllowedValues
    # refs:
    #   table_id: users
    #   column_id: gender
    # params:
    #   allowed_values: ["男", "女"]

    # DateLogic 约束
    # id: birth_date_check
    # type: DateLogic
    # refs:
    #   table_id: users
    #   column_id: birth_date
    # params:
    #   logic_mode: compare
    #   compare_op: gt
    #   reference_date: "2000-01-01"

    # ForeignKey 约束
    # id: fk_order_user
    # type: ForeignKey
    # refs:
    #   from_table_id: orders
    #   from_column_id: user_id
    #   to_table_id: users
    #   to_column_id: user_id
    ```

    ============================================================================
    字段映射说明 (YAML 如何变成 Python 对象)
    ============================================================================
    | YAML 字段 | Python 属性 | 数据类型 | 说明 | 示例值 |
    |----------|------------|---------|------|-------|
    | version | version | int | 配置版本号 | 2 |
    | id | id | str | 约束 ID | "unique_user_email" |
    | type | type | str | 约束类型 | "Unique" |
    | enabled | enabled | bool | 是否启用 | true |
    | description | description | Optional[str] | 约束描述 | "用户邮箱必须唯一" |
    | refs | refs | Dict[str, Any] | 引用区 | {"table_id": "users"} |
    | params | params | Dict[str, Any] | 参数区 | {"allowed_values": [...]} |

    ============================================================================
    业务场景 (这个类在什么地方被使用)
    ============================================================================
    - 场景1: 创建独立约束规则
      用户希望创建一条独立的约束规则，可以在多个表间复用。

    - 场景2: 加载约束配置
      系统读取 *.constraint.yaml 文件，解析为 ConstraintFile 对象。

    - 场景3: 保存约束配置
      用户修改约束配置后，将 ConstraintFile 对象写回 YAML 文件。

    ============================================================================
    约束配置分离设计说明
    ============================================================================
    refs（引用区）和 params（参数区）的分离设计：

    1. refs（引用区）：
       - 用 ID 指向表/列，定义约束作用的目标对象
       - 结构因约束类型而异
       - 通常包含 table_id、column_id(s) 等

    2. params（参数区）：
       - 除引用之外的可编辑参数
       - 存储约束的具体参数值
       - 如 allowed_values、expression、min/max 等

    分离优势：
       - 同一约束类型可以复用相同的 refs 结构
       - params 变化不影响 refs，便于版本管理
       - UI 表单可以分别处理引用和参数

    ============================================================================
    使用示例
    ============================================================================
    【创建 Unique 约束】
    ```python
    from app.shared.core.project.constraint.types import ConstraintFile

    constraint = ConstraintFile(
        version=2,
        id="unique_user_email",
        type="Unique",
        enabled=True,
        description="用户邮箱必须唯一",
        refs={
            "table_id": "users",
            "column_ids": ["email"]
        },
        params={}
    )
    ```

    【创建 AllowedValues 约束】
    ```python
    constraint = ConstraintFile(
        id="gender_allowed",
        type="AllowedValues",
        refs={
            "table_id": "users",
            "column_id": "gender"
        },
        params={
            "allowed_values": ["男", "女", "未知"]
        }
    )
    ```

    【从 YAML 加载】
    ```python
    raw = read_yaml(Path("constraints/unique_user_email.constraint.yaml"))
    constraint = ConstraintFile.model_validate(raw)
    ```
    """

    # 配置版本号，固定为 2
    version: int = Field(2, description="配置版本号（固定为 2）")
    # 约束 ID（稳定标识），在项目中应保持不变
    id: str = Field(..., description="约束 ID（稳定标识）")
    # 约束类型，对应注册表中的键（如 Unique、NotNull 等）
    type: Literal[
        "Unique",
        "NotNull",
        "AllowedValues",
        "ForeignKey",
        "Conditional",
        "Scripted",
        "Range",
        "Charset",
        "DateLogic",
        "Composite",
    ] = Field(..., description="约束类型（注册表键）")
    # 是否启用该约束
    enabled: bool = Field(True, description="是否启用")
    # 约束描述信息，供 UI 显示
    description: str | None = Field(None, description="描述")
    # 引用区：用 ID 指向表/列，定义约束作用的目标对象
    # 结构因约束类型而异，详见各 Refs 类
    refs: dict[str, Any] = Field(default_factory=dict, description="引用区：用 id 指向表/列")
    # 参数区：除引用之外的可编辑参数
    # 如 AllowedValues 的 allowed_values 列表、Scripted 的 expression 等
    params: dict[str, Any] = Field(default_factory=dict, description="参数区：除引用之外的可编辑参数")
    # 数据流输入：指定上游节点 ID，优先于 refs 的 Schema 引用
    # 若存在，约束节点从该上游节点获取数据列执行校验；否则回退到传统 refs 方式
    input_from_node: str | None = Field(None, description="上游数据流节点 ID（优先于 Schema 引用）")


# ============================================================
# 兼容别名定义（V2 类型导出）
# ============================================================
# ConstraintFileV2 被 API 层广泛引用，保留以维持兼容性
# 其余 RefsV2 别名已清理（无活跃引用）

ConstraintFileV2 = ConstraintFile
