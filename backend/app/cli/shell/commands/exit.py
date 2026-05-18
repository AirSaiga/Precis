# backend/app/cli/shell/commands/exit.py
"""
@fileoverview CLI Shell 退出命令模块

功能概述:
- 提供 exit 和 quit 命令退出交互式 Shell
- 返回 should_exit=True 的结果使主循环终止
- 支持别名 quit，方便用户习惯

架构设计:
- ExitCommand 继承 Command 基类
- execute() 直接返回 CommandResult.exit()，主循环检测 should_exit 后退出

输入示例:
    precis> exit
    precis> quit

输出示例:
    CommandResult.exit("再见!")
"""

from app.cli.shell.commands.base import Command, CommandContext, CommandResult


class ExitCommand(Command):
    """退出命令。

    当用户输入 exit 或 quit 时触发，使 Shell 主循环终止。
    """

    def __init__(self):
        super().__init__("exit", aliases=["quit"])

    @property
    def description(self) -> str:
        return "退出 Precis CLI"

    @property
    def usage(self) -> str:
        return "exit"

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行退出命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            context: 命令上下文

        Returns:
            带有 should_exit=True 的结果，触发 Shell 退出
        """
        return CommandResult.exit("再见!")
