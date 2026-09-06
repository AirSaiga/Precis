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
"""@fileoverview 约束构建器子包

通过 side-effect import 触发各 builder 的 @register_builder 注册。
新增约束类型时，新建 builder 文件并在本文件 import 即可自动注册。

注册清单：
- single_column: NotNull / AllowedValues / DateLogic / Range / Charset
- unique: Unique（多列 list 语义）
- foreign_key: ForeignKey（双向引用）
- conditional: Conditional（IF 条件列表）
- scripted: Scripted（可选列）
- composite: Composite（递归子约束）
"""

from __future__ import annotations

# side-effect import：触发各模块顶层的 @register_builder 调用
from . import (  # noqa: F401
    composite,
    conditional,
    foreign_key,
    scripted,
    single_column,
    unique,
)
from .base import BuilderInput, BuilderResult
from .registry import CONSTRAINT_BUILDERS, build_kwargs, register_builder

__all__ = [
    "BuilderInput",
    "BuilderResult",
    "CONSTRAINT_BUILDERS",
    "build_kwargs",
    "register_builder",
]
