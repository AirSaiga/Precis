"""
@fileoverview 约束系统包入口（C01 精简版）

功能概述:
- 作为 C01 workspace 的约束系统包入口
- 仅导出 workspace 实际包含的约束类（Constraint 基类、NotNullConstraint）
- 供挑战者参考：真实仓库的 __init__.py 导出全部 13 种约束，
  但本 workspace 只复制了 base.py 和 not_null.py 两种。

架构设计:
- 各约束子模块独立实现，继承自 Constraint 基类
- 通过 __init__.py 聚合导出，降低调用方的导入成本

输入示例:
    from app.shared.domain.constraints import NotNullConstraint

输出示例:
    # 可直接使用本 workspace 内已注册的约束类
"""

# ============================================================================
# 1. 项目内部导入: 从 workspace 已有的子模块导入约束实现类
# ============================================================================
# 本 workspace 仅包含 base.py 和 not_null.py 两个子模块（加上挑战者新建的
# maxlength_constraint.py）。真实仓库的 __init__.py 还导出 Unique、Range、
# ForeignKey、Conditional、Charset、DateLogic、AllowedValues、Regex、Scripted、
# Composite 等，但这些在本挑战中用不到，未复制进 workspace。

from app.shared.domain.constraints.base import Constraint
from app.shared.domain.constraints.not_null import NotNullConstraint

# ============================================================================
# __all__ 控制 from module import * 时导出的符号列表
# ============================================================================
# 挑战者完成任务后，应在此追加 MaxLengthConstraint 的 import 行和 __all__ 条目。

__all__ = [
    "Constraint",
    "NotNullConstraint",
]
