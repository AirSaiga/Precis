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
@fileoverview 数据类型子模块聚合导出

功能概述:
- 集中导出所有数据类型子模块的符号
- 简化上层模块对 data_types_parts 的导入路径

架构设计:
- 扁平化聚合: 将 base、scalars、composite、expression 等子模块统一暴露
- 显式接口控制: 通过 __all__ 限定公开符号

输入示例:
    from app.shared.domain.data_types_parts import StringType, DataType, ExpressionType

输出示例:
    dtype = DataType.create("string")  # 返回 StringType 实例
"""

# 1. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType
from app.shared.domain.data_types_parts.composite import CompositeConditionType, SpecificCompositeConditionType
from app.shared.domain.data_types_parts.expression import ExpressionType, SpecificExpressionType
from app.shared.domain.data_types_parts.extracted import ExtractedType
from app.shared.domain.data_types_parts.json_types import JsonArrayType, JsonNullType, JsonObjectType
from app.shared.domain.data_types_parts.scalars import (
    BooleanType,
    DateType,
    DecimalType,
    FloatType,
    IntegerType,
    StringType,
)
from app.shared.domain.data_types_parts.sequence import SequenceType

__all__ = [
    "BooleanType",
    "CompositeConditionType",
    "DataType",
    "DateType",
    "DecimalType",
    "ExpressionType",
    "ExtractedType",
    "FloatType",
    "IntegerType",
    "JsonArrayType",
    "JsonNullType",
    "JsonObjectType",
    "SequenceType",
    "SpecificCompositeConditionType",
    "SpecificExpressionType",
    "StringType",
]
