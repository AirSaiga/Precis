"""
@fileoverview 校验器模块入口

功能概述:
- 导出所有内置数据校验器实现
- 采用策略模式,每个校验器实现一种特定校验逻辑
- 所有校验器继承自 BaseValidator,实现统一 validate 接口

架构设计:
- 策略模式(Strategy Pattern): 每种校验逻辑封装为独立校验器类
- 统一接口: 所有校验器实现 validate() 方法,返回 ValidationResult
- 解耦设计: 新增校验器无需修改现有代码,只需实现接口并导出
"""

from .adapter import ConstraintAdapter
from .allowed_values import AllowedValuesValidator
from .base import BaseValidator
from .charset import CharsetValidator
from .conditional import ConditionalValidator
from .date_logic import DateLogicValidator
from .foreign_key import ForeignKeyValidator
from .not_null import NotNullValidator
from .range import RangeValidator
from .regex import RegexValidator
from .scripted import ScriptedValidator
from .unique import UniqueValidator

__all__ = [
    "BaseValidator",
    "ConstraintAdapter",
    "RegexValidator",
    "UniqueValidator",
    "NotNullValidator",
    "AllowedValuesValidator",
    "RangeValidator",
    "ForeignKeyValidator",
    "ConditionalValidator",
    "ScriptedValidator",
    "CharsetValidator",
    "DateLogicValidator",
]
