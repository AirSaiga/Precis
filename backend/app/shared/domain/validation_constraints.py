"""
@fileoverview 数据约束兼容导出模块

功能概述:
- 作为约束系统的兼容层，保留同名符号导出
- 避免因约束实现拆分带来的外部导入路径变更和破坏性影响
- 集中导出所有约束类型和条件注册表

架构设计:
- 代理导出模式: 实际实现已迁移至 app.shared.domain.constraints 包
- 本模块仅做 re-export，无独立业务逻辑

输入示例:
    from app.shared.domain.validation_constraints import NotNullConstraint, UniqueConstraint, CONDITION_REGISTRY

输出示例:
    # 可直接使用所有约束类和 register_condition 装饰器
"""

# 1. 项目内部导入
# 从新的约束包中导入所有约束类，保持向后兼容
# 外部代码仍可通过本模块导入，无需修改导入路径
from app.shared.domain.constraints import (
    AllowedValuesConstraint,
    CharsetConstraint,
    CompositeConstraint,
    ConditionalConstraint,
    Constraint,
    DateLogicConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    RangeConstraint,
    ScriptedConstraint,
    UniqueConstraint,
)
from app.shared.domain.constraints.condition_registry import CONDITION_REGISTRY, register_condition

# __all__ 显式声明本模块对外暴露的符号
# 作用：1. 控制 from module import * 的行为；2. 明确模块公共 API 边界
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
    "ScriptedConstraint",
    "UniqueConstraint",
    "register_condition",
]
