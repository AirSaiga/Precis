"""
@fileoverview 校验服务模块入口

功能概述:
- 统一导出校验服务相关的类型、服务和校验器
- 提供 ValidationType、ValidationResult 等核心类型
- 提供 UnifiedValidationService 统一校验服务
- 提供文件加载和校验执行便捷函数
- 导出所有内置校验器实现

架构设计:
- 模块入口模式: 通过 __init__.py 集中管理对外暴露的 API
- 所有子模块通过相对导入聚合,降低调用方使用成本
"""

from .loader import (
    load_file_data,
    load_file_data_with_settings,
    run_validation,
    validate_with_settings,
)
from .service import UnifiedValidationService
from .types import ValidationResult, ValidationType
from .validators import (
    AllowedValuesValidator,
    BaseValidator,
    CharsetValidator,
    ConditionalValidator,
    DateLogicValidator,
    ForeignKeyValidator,
    NotNullValidator,
    RangeValidator,
    RegexValidator,
    ScriptedValidator,
    UniqueValidator,
)

__all__ = [
    # 类型定义
    "ValidationType",
    "ValidationResult",
    # 服务类
    "UnifiedValidationService",
    # 文件加载和校验函数
    "load_file_data",
    "run_validation",
    "load_file_data_with_settings",
    "validate_with_settings",
    # 校验器类
    "BaseValidator",
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
