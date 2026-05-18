"""
@fileoverview 约束系统包入口

功能概述:
- 作为约束实现拆分后的包入口，统一导出所有约束类
- 保持向后兼容，旧模块仍可通过 re-export 访问同名符号
- 集中管理 Unique、NotNull、Range、ForeignKey、Conditional 等约束实现

架构设计:
- 各约束子模块独立实现，继承自 Constraint 基类
- 通过 __init__.py 聚合导出，降低调用方导入成本

输入示例:
    from app.shared.domain.constraints import NotNullConstraint, UniqueConstraint, CONDITION_REGISTRY

输出示例:
    # 可直接使用所有约束类及 register_condition 注册装饰器
"""

# ============================================================================
# 1. 项目内部导入: 从各子模块导入具体的约束实现类
# ============================================================================

from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint
from app.shared.domain.constraints.base import Constraint
from app.shared.domain.constraints.charset import CharsetConstraint
from app.shared.domain.constraints.composite import CompositeConstraint
from app.shared.domain.constraints.condition_registry import CONDITION_REGISTRY, register_condition
from app.shared.domain.constraints.conditional import ConditionalConstraint
from app.shared.domain.constraints.date_logic import DateLogicConstraint
from app.shared.domain.constraints.foreign_key import ForeignKeyConstraints
from app.shared.domain.constraints.not_null import NotNullConstraint
from app.shared.domain.constraints.range import RangeConstraint
from app.shared.domain.constraints.regex import RegexConstraint
from app.shared.domain.constraints.scripted import ScriptedConstraint
from app.shared.domain.constraints.unique import UniqueConstraint

# ============================================================================
# __all__ 控制 from module import * 时导出的符号列表
# ============================================================================

__all__ = [
    "AllowedValuesConstraint",
    "CharsetConstraint",
    "CompositeConstraint",
    "CONDITION_REGISTRY",
    "ConditionalConstraint",
    "Constraint",
    "DateLogicConstraint",
    "ForeignKeyConstraints",
    "NotNullConstraint",
    "RangeConstraint",
    "RegexConstraint",
    "ScriptedConstraint",
    "UniqueConstraint",
    "register_condition",
]
