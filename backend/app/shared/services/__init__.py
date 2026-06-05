"""
@fileoverview 共享服务层包初始化模块

功能概述:
- 聚合并暴露校验服务相关的类和函数
- 统一导出校验器、执行器、校验结果等核心组件
- 作为 API 层和 CLI 层共享服务层的统一入口

架构设计:
- 门面模式: 通过 __all__ 控制对外暴露的接口
- 聚合导出: 从 validation 子模块集中导入核心组件
"""

from .validation import (
    AllowedValuesValidator,
    BaseValidator,
    CharsetValidator,
    ChunkedDataLoader,
    ChunkedValidationResult,
    ConditionalValidator,
    DateLogicValidator,
    ForeignKeyValidator,
    MemoryMonitor,
    NotNullValidator,
    RangeValidator,
    RegexValidator,
    ScriptedValidator,
    UnifiedValidationService,
    UniqueValidator,
    ValidationResult,
    ValidationType,
    load_file_data,
    load_file_data_with_settings,
    run_validation,
    validate_with_settings,
)
from .validation.engine import validate_full_dataset
from .validation.executor import (
    ValidationExecutor,
    ValidationOptions,
    create_executor,
)

__all__ = [
    # 校验服务
    "ValidationType",
    "ValidationResult",
    "UnifiedValidationService",
    "load_file_data",
    "run_validation",
    "load_file_data_with_settings",
    "validate_with_settings",
    # 校验器
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
    # 执行器
    "ValidationExecutor",
    "ValidationOptions",
    "create_executor",
    "validate_full_dataset",
    # 性能工具
    "MemoryMonitor",
    "ChunkedDataLoader",
    "ChunkedValidationResult",
]
