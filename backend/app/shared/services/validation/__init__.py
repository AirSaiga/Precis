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
@fileoverview 校验服务模块入口

功能概述:
- 统一导出校验服务相关的类型、服务和校验器
- 提供 ValidationType、ValidationResult 等核心类型
- 提供 UnifiedValidationService 统一校验服务
- 提供文件加载便捷函数
"""

from .chunked_loader import ChunkedDataLoader, ChunkedValidationResult
from .loader import load_file_data
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
    "BaseValidator",
    "ConstraintAdapter",
    "PreCheck",
    "CompositeValidator",
    "DateLogicValidator",
    "MemoryMonitor",
    "ChunkedDataLoader",
    "ChunkedValidationResult",
]
