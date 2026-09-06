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
@fileoverview 约束类型兼容层模块

功能概述:
- 向后兼容的重新导出入口
- 将 constraint.types 子包的内容暴露到 app.shared.core.project.constraint.types 命名空间

架构设计:
- 兼容层模式：保持历史导入路径稳定
- 无逻辑：仅重新导出，不定义新类型
"""

from .types import *  # noqa: F401,F403
