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

# 从 loader 模块导入文件加载和校验执行的便捷函数
# 这些函数是调用方快速执行校验的入口，封装了完整的加载+校验流程
from .loader import (
    load_file_data,
    load_file_data_with_settings,
    run_validation,
    validate_with_settings,
)

# 从 service 模块导入统一校验服务类
# UnifiedValidationService 负责注册和管理各类校验器， orchestrate 校验流程
from .service import UnifiedValidationService

# 从 types 模块导入核心类型定义
# ValidationType 定义校验类型常量，ValidationResult 封装校验结果
from .types import ValidationResult, ValidationType

# 从 validators 包导入所有内置校验器实现
# 每个校验器类对应一种 ValidationType，负责执行具体的验证逻辑
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

# __all__ 按功能分组声明对外暴露的符号，便于调用方快速定位所需 API
# 分组顺序：类型定义 -> 服务类 -> 便捷函数 -> 校验器类
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
