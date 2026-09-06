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
# backend/app/cli/shell/commands/__init__.py
"""
@fileoverview CLI Shell 命令集合入口

功能概述:
- 聚合导出所有内置 Shell 命令类
- 统一暴露命令基类与结果类型
- 作为外部模块导入 commands 包时的统一入口

架构设计:
- 从各子模块导入具体的命令类
- 通过 __all__ 显式控制对外暴露的接口
- 遵循 Python 包导入规范，避免循环依赖

输入示例:
    from app.cli.shell.commands import HelpCommand, OpenCommand

输出示例:
    导入后可直接使用 HelpCommand() 等命令类
"""

from app.cli.shell.commands.ai import AICommand
from app.cli.shell.commands.base import Command, CommandResult
from app.cli.shell.commands.config import ConfigCommand
from app.cli.shell.commands.exit import ExitCommand
from app.cli.shell.commands.help import HelpCommand
from app.cli.shell.commands.open import OpenCommand
from app.cli.shell.commands.project import ProjectCommand
from app.cli.shell.commands.provider import ProviderCommand
from app.cli.shell.commands.system import LsCommand, PwdCommand
from app.cli.shell.commands.validate import ValidateCommand

__all__ = [
    "Command",
    "CommandResult",
    "HelpCommand",
    "OpenCommand",
    "ProjectCommand",
    "ValidateCommand",
    "ConfigCommand",
    "ExitCommand",
    "ProviderCommand",
    "AICommand",
    "PwdCommand",
    "LsCommand",
]
