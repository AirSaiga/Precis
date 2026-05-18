# backend/app/cli/shell/commands/help.py
"""
@fileoverview CLI Shell 帮助命令模块

功能概述:
- 提供 help 命令显示所有可用命令列表
- 支持查看特定命令的详细帮助文本
- 格式化输出命令名称与描述

架构设计:
- HelpCommand 接收 CommandRegistry 实例，从中获取所有注册命令
- 无参数时显示所有命令的简要列表
- 带参数时显示指定命令的详细帮助文本

输入示例:
    precis> help
    precis> help validate

输出示例:
    可用命令列表或特定命令的 help_text
"""

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.formatter import Formatter
from app.cli.shell.parser import CommandRegistry


class HelpCommand(Command):
    """帮助命令。

    显示所有可用命令的列表，或查看特定命令的详细帮助。
    """

    def __init__(self, registry: CommandRegistry):
        """初始化帮助命令。

        Args:
            registry: 命令注册表，包含所有已注册的命令
        """
        super().__init__("help", aliases=["?"])
        self._registry = registry

    @property
    def description(self) -> str:
        return "显示所有可用命令或特定命令的帮助信息"

    @property
    def usage(self) -> str:
        return "help [command]"

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行帮助命令。

        Args:
            args: 命令参数列表，为空显示所有命令，否则显示指定命令帮助
            context: 命令上下文

        Returns:
            格式化的帮助文本
        """
        if not args:
            return self._show_all_commands()
        else:
            return self._show_command_help(args[0])

    def _show_all_commands(self) -> CommandResult:
        """显示所有可用命令的列表。

        Returns:
            包含所有命令名称和描述的格式化文本
        """
        commands = self._registry.get_all_commands()

        lines = [Formatter.header("\n可用命令:"), ""]

        for cmd in commands:
            lines.append(f"  {Formatter.info(cmd.name):15} - {cmd.description}")

        lines.append("")
        lines.append(Formatter.dim("输入 'help <command>' 查看特定命令的详细帮助"))
        lines.append(Formatter.dim("输入 'exit' 或 'quit' 退出 CLI"))

        return CommandResult.ok("\n".join(lines))

    def _show_command_help(self, command_name: str) -> CommandResult:
        """显示特定命令的详细帮助。

        Args:
            command_name: 要查看帮助的命令名称

        Returns:
            命令的详细帮助文本，或错误提示
        """
        command = self._registry.get(command_name)
        if command is None:
            return CommandResult.error(f"未知命令: {command_name}")

        return CommandResult.ok(command.help_text)
