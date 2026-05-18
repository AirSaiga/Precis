"""
@fileoverview 约束规则读取模块

功能概述:
- 从 *.constraint.yaml 文件读取约束配置
- 验证约束配置文件的格式和内容
- 支持批量加载多个约束配置文件

架构设计:
- 读取层: 将 YAML 配置文件解析为程序可用的 Python 对象
- 数据验证: 使用 Pydantic 确保配置文件格式正确
- 读写配合: 与 writer.py 配合实现约束配置全生命周期管理

输入示例:
    # users.constraint.yaml
    version: 2
    id: unique_email
    type: Unique
    enabled: true
    refs:
      table_id: users
      column_ids: [email]

输出示例:
    constraint = load_constraint("users.constraint.yaml")
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import ValidationError

# 导入底层的 YAML 读取工具
from app.shared.core.io.yaml import read_yaml

# 导入约束配置的数据模型
from .types import ConstraintFile

if TYPE_CHECKING:
    # 仅在类型检查阶段导入，避免运行时循环依赖
    from .types import ConstraintFile


def load_constraint(constraint_path: str | Path) -> ConstraintFile:
    """
    @methoddesc 从 YAML 文件加载约束配置。

    ============================================================================
    配置文件示例 (本函数处理的配置文件长这样)
    ============================================================================
    本函数处理以下格式的 *.constraint.yaml 文件：

    ```yaml
    # ============================================================
    # 约束规则配置文件 (*.constraint.yaml)
    # ============================================================

    version: 2

    id: unique_user_email

    type: Unique

    enabled: true

    description: "用户邮箱必须唯一"

    refs:
      table_id: users
      column_ids: [email]

    params: {}
    ```

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 项目启动时加载约束配置
      系统启动时需要加载所有约束配置文件，构建运行时约束对象。

    - 场景2: 加载单个约束详情
      用户在 UI 上查看某个约束的详细信息。

    - 场景3: 约束配置导入验证
      导入约束配置文件时，需要验证格式是否正确。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - constraint_path: str | Path，constraint 文件路径
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
      │ 输出: ConstraintFile 对象                               │
      └─────────────────────────────────────────────────────────────┘

    最终输出: ConstraintFile 对象

    ============================================================================
    异常处理
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | FileNotFoundError | 文件不存在 | 检查文件路径 |
    | ValueError | YAML 格式错误 | 验证 YAML 文件 |
    | ValueError | 验证失败 | 检查配置格式 |

    :param constraint_path: constraint 文件路径，可以是字符串或 Path 对象
    :return: ConstraintFile 对象，包含验证后的约束配置数据
    :raises ValueError: 文件不存在、格式错误或验证失败时抛出
    :raises FileNotFoundError: 文件路径不存在时由 read_yaml 抛出
    """
    # 步骤1：标准化路径格式，兼容字符串和 Path 对象输入
    path = Path(constraint_path)
    # 步骤2：读取 YAML 文件原始内容（字典格式）
    raw = read_yaml(path)
    # 步骤3：使用 Pydantic 验证数据格式，确保必填字段存在且类型正确
    try:
        return ConstraintFile.model_validate(raw)
    except ValidationError as e:
        # 步骤4：验证失败时抛出带详细信息的 ValueError
        raise ValueError(f"constraint 校验失败: {constraint_path}\n{e}") from e


def load_constraints(constraint_paths: list) -> dict[str, ConstraintFile]:
    """
    @methoddesc 批量加载约束配置。

    ============================================================================
    业务场景 (什么情况下会调用这个函数)
    ============================================================================
    - 场景1: 项目启动时加载所有约束
      系统启动时需要批量加载项目中所有的约束配置文件。

    - 场景2: 批量导入约束
      用户可以一次性导入多个约束配置文件。

    ============================================================================
    数据流 (输入如何变成输出)
    ============================================================================
    输入参数:
      - constraint_paths: list，constraint 文件路径列表
        示例值: [
            "constraints/unique_email.constraint.yaml",
            "constraints/gender_allowed.constraint.yaml"
        ]

    处理步骤:
      遍历路径列表，依次调用 load_constraint 加载每个约束

    最终输出: Dict[str, ConstraintFile]，约束 ID -> ConstraintFile 映射
      示例:
        constraints = load_constraints(paths)
        print(constraints.keys())  # dict_keys(['unique_email', 'gender_allowed'])

    ============================================================================
    异常处理
    ============================================================================
    | 异常类型 | 触发条件 | 处理方式 |
    |---------|---------|---------|
    | ValueError | 单个文件加载失败 | 停止并抛出异常 |

    :param constraint_paths: constraint 文件路径列表，每个元素为文件路径
    :return: 约束配置字典，键为 constraint.id（约束ID），值为 ConstraintFile 对象
    :raises ValueError: 任一文件加载或验证失败时抛出
    """
    # 初始化结果字典，使用 constraint_id 作为键便于后续快速查找
    constraints: dict[str, ConstraintFile] = {}
    # 遍历所有文件路径，依次加载每个约束配置
    for path in constraint_paths:
        # 加载单个约束配置（包含验证）
        constraint = load_constraint(path)
        # 以约束ID为键存储，支持快速通过ID获取约束配置
        constraints[constraint.id] = constraint
    return constraints
