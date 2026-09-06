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
@fileoverview 校验器模块入口

功能概述:
- 导出所有内置数据校验器实现
- ConstraintAdapter 通用适配器替代大部分独立 Validator 文件
- DateLogicValidator 和 CompositeValidator 保留独立实现
"""

from .adapter import ConstraintAdapter, PreCheck
from .base import BaseValidator
from .composite import CompositeValidator
from .date_logic import DateLogicValidator

__all__ = [
    "BaseValidator",
    "ConstraintAdapter",
    "PreCheck",
    "CompositeValidator",
    "DateLogicValidator",
]
