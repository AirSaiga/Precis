"""
@fileoverview 约束规则写入模块

功能概述:
- 写入 *.constraint.yaml 文件
- 将程序中的 ConstraintFile 对象持久化为 YAML 格式配置文件

架构设计:
- 写入层: 负责将配置对象序列化并写入文件系统
- 简洁输出: 使用 model_dump(exclude_none=True) 排除 None 字段
- 读写配合: 与 reader.py 配合实现约束配置全生命周期管理

输入示例:
    constraint = ConstraintFile(
        version=2,
        id="not_null_email",
        type="NotNull",
        enabled=True,
        refs={"table_id": "users", "column_id": "email"},
        params={},
    )

输出示例:
    save_constraint(constraint, "constraints/email.constraint.yaml")
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

# 导入底层的 YAML 写入工具
from app.shared.core.io.yaml import write_yaml

# 导入约束配置的数据模型
from .types import ConstraintFile

if TYPE_CHECKING:
    # 仅在类型检查阶段导入，避免运行时循环依赖
    from .types import ConstraintFile


def save_constraint(constraint: ConstraintFile, constraint_path: str | Path) -> None:
    """
    @methoddesc 保存约束到 YAML 文件。

    ============================================================================
    输入数据示例 (这个函数接收什么数据)
    ============================================================================
    本函数接收 ConstraintFile 对象：

    ```python
    # 创建 Unique 约束对象
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

    写入后的 YAML 文件内容：

    ```yaml
    # 约束规则配置文件 (*.constraint.yaml)
    version: 2

    id: unique_user_email

    type: Unique

    enabled: true

    description: "用户邮箱必须唯一"

    refs:
      table_id: users
      column_ids:
        - email

    params: {}
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 用户通过 UI 创建约束
      用户在约束创建页面填写完配置表单后，点击保存按钮。
      系统将表单数据构建为 ConstraintFile 对象，然后调用 save_constraint
      将其写入到 constraints/ 目录下的 *.constraint.yaml 文件。

    - 场景2: 用户通过 UI 编辑约束
      用户修改现有约束的配置后，点击保存按钮。
      系统更新 ConstraintFile 对象并写回原文件。

    - 场景3: 导入约束配置
      用户导入约束配置文件时，系统将其写入项目目录。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - constraint: ConstraintFile，约束配置对象
        示例值: ConstraintFile(id="unique_user_email", type="Unique", ...)
      - constraint_path: str | Path，目标文件路径
        示例值: "constraints/unique_user_email.constraint.yaml"

    处理步骤:
      ┌─────────────────────────────────────────────────────────────┐
      │ Step 1: 路径标准化                                      │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 字符串或 Path 对象                                  │
      │ 操作: 转换为 Path 对象                                    │
      │ 输出: Path 对象                                          │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 2: 对象序列化为字典                                 │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: ConstraintFile 对象                                │
      │ 操作: 使用 model_dump(exclude_none=True) 转换为字典       │
      │       exclude_none=True 排除值为 None 的可选字段          │
      │ 输出: Dict 对象                                          │
      └─────────────────────────────────────────────────────────────┘

      ┌─────────────────────────────────────────────────────────────┐
      │ Step 3: 写入 YAML 文件                                  │
      ├─────────────────────────────────────────────────────────────┤
      │ 输入: 字典对象                                          │
      │ 操作: 调用 write_yaml 写入文件                           │
      │ 输出: (无返回值，文件已写入)                            │
      └─────────────────────────────────────────────────────────────┘

    最终输出: None (无返回值，写入成功后直接返回)

    ============================================================================
    异常处理 (可能出什么问题)
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | PermissionError | 没有写入权限 | 检查文件/目录权限 |
    | FileNotFoundError | 父目录不存在 | 检查路径有效性 |

    :param constraint: ConstraintFile 对象，包含完整的约束配置数据
    :param constraint_path: 保存路径，可以是字符串或 Path 对象
    :return: 无返回值（写入文件后直接返回）
    :raises IOError: 文件写入失败时由 write_yaml 抛出

    示例：
        constraint = ConstraintFile(
            id="unique_user_email",
            type="Unique",
            refs={"table_id": "users", "column_ids": ["email"]},
            params={}
        )
        save_constraint(constraint, "/project/constraints/unique_user_email.constraint.yaml")
    """
    # 步骤1：标准化路径格式，兼容字符串和 Path 对象输入
    Path(constraint_path)
    # 步骤2：将 ConstraintFile 对象转换为字典，exclude_none=True 排除空值字段
    # 步骤3：调用底层 YAML 写入函数将数据持久化到文件
    write_yaml(Path(constraint_path), constraint.model_dump(exclude_none=True))
