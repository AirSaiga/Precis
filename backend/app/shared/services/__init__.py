"""
@fileoverview 共享服务层包初始化模块

功能概述:
- 聚合并暴露校验服务相关的类和函数
- 统一导出校验器、执行器、校验结果等核心组件
"""

from .validation import (
    BaseValidator,
    ChunkedDataLoader,
    ChunkedValidationResult,
    CompositeValidator,
    ConstraintAdapter,
    DateLogicValidator,
    MemoryMonitor,
    PreCheck,
    UnifiedValidationService,
    ValidationResult,
    ValidationType,
    load_file_data,
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
    "ValidationType",
    "ValidationResult",
    "UnifiedValidationService",
    "load_file_data",
    "run_validation",
    "validate_with_settings",
    "BaseValidator",
    "ConstraintAdapter",
    "PreCheck",
    "CompositeValidator",
    "DateLogicValidator",
    "ValidationExecutor",
    "ValidationOptions",
    "create_executor",
    "validate_full_dataset",
    "MemoryMonitor",
    "ChunkedDataLoader",
    "ChunkedValidationResult",
]
