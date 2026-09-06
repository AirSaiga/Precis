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
# backend/app/cli/shell/commands/exit.py
"""
@fileoverview CLI Shell 退出命令模块

功能概述:
- 提供 exit 命令退出交互式 Shell
- 返回 should_exit=True 的结果使主循环终止
- 全局快捷键 qq 可直接退出程序

架构设计:
- ExitCommand 继承 Command 基类
- execute() 直接返回 CommandResult.exit()，主循环检测 should_exit 后退出

输入示例:
    precis> exit

输出示例:
    CommandResult.exit("再见!")
"""

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext


class ExitCommand(Command):
    """退出命令。

    当用户输入 exit 时触发，使 Shell 主循环终止。
    全局快捷键 qq 仍可直接退出程序。
    """

    def __init__(self) -> None:
        super().__init__("exit")

    @property
    def description(self) -> str:
        return "退出 Precis CLI"

    @property
    def usage(self) -> str:
        return "exit"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行退出命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            context: 项目上下文

        Returns:
            带有 should_exit=True 的结果，触发 Shell 退出
        """
        return CommandResult.exit("再见!")
