# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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
