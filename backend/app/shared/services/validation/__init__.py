"""
@fileoverview 校验服务模块入口

功能概述:
- 统一导出校验服务相关的类型、服务和校验器
- 提供 ValidationType、ValidationResult 等核心类型
- 提供 UnifiedValidationService 统一校验服务
- 提供文件加载和校验执行便捷函数
"""

from .chunked_loader import ChunkedDataLoader, ChunkedValidationResult
from .loader import (
    load_file_data,
    run_validation,
    validate_with_settings,
)
from .memory_monitor import MemoryMonitor
from .service import UnifiedValidationService
from .types import ValidationResult, ValidationType
from .validators import (
    BaseValidator,
    CompositeValidator,
    ConstraintAdapter,
    DateLogicValidator,
    PreCheck,
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
    "MemoryMonitor",
    "ChunkedDataLoader",
    "ChunkedValidationResult",
]
