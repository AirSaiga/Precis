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
@fileoverview 约束类型统一导出模块

功能概述:
- 集中导出所有约束相关的数据类型
- 统一 ConstraintFile、ConstraintFileV2 和各约束 refs 类型
- 简化外部模块的导入路径

架构设计:
- 聚合导出：从 constraint_file.py 和 refs.py 收集类型
- __all__ 显式控制：明确对外暴露的符号列表

输入示例:
    from app.shared.core.project.constraint.types import ConstraintFileV2, UniqueRefs

输出示例:
    可直接使用导入的类型构建约束配置
"""

from .constraint_file import ConstraintFile, ConstraintFileV2, ConstraintType
from .refs import (
    AllowedValuesRefs,
    CharsetRefs,
    ConditionalIfCondition,
    ConditionalRefs,
    DateLogicRefs,
    ForeignKeyRefs,
    NotNullRefs,
    RangeRefs,
    ScriptedRefs,
    UniqueRefs,
)

__all__ = [
    "ConstraintFile",
    "ConstraintFileV2",
    "ConstraintType",
    "AllowedValuesRefs",
    "CharsetRefs",
    "ConditionalIfCondition",
    "ConditionalRefs",
    "DateLogicRefs",
    "ForeignKeyRefs",
    "NotNullRefs",
    "RangeRefs",
    "ScriptedRefs",
    "UniqueRefs",
]
