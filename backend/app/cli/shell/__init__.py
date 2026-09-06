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
# backend/app/cli/shell/__init__.py
"""
@fileoverview CLI Shell 模块入口

功能概述:
- 聚合导出 CLI Shell 核心组件（异常、格式化器）
- 提供统一的模块外部接口
"""

from app.cli.shell.exceptions import (
    CLIError,
    CommandNotFoundError,
    ConfigError,
    EditorError,
    InvalidProjectError,
    NoProjectOpenError,
    ProjectNotFoundError,
    ValidationError,
)
from app.cli.shell.formatter import Colors, Formatter

__all__ = [
    "CLIError",
    "ProjectNotFoundError",
    "InvalidProjectError",
    "NoProjectOpenError",
    "CommandNotFoundError",
    "ValidationError",
    "ConfigError",
    "EditorError",
    "Formatter",
    "Colors",
]
