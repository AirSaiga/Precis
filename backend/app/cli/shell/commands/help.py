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

from rich.console import Console
from rich.table import Table

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.parser import CommandRegistry

_console = Console()


class HelpCommand(Command):
    """帮助命令。

    显示所有可用命令的列表，或查看特定命令的详细帮助。
    """

    def __init__(self, registry: CommandRegistry):
        super().__init__("help", aliases=["?"])
        self._registry = registry

    @property
    def description(self) -> str:
        return "显示所有可用命令或特定命令的帮助信息"

    @property
    def usage(self) -> str:
        return "help [command]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        if not args:
            return self._show_all_commands()
        else:
            return self._show_command_help(args[0])

    def _show_all_commands(self) -> CommandResult:
        commands = self._registry.get_all_commands()

        _console.print()
        _console.print("[bold]可用命令:[/bold]")
        _console.print()

        table = Table(show_header=False, box=None, padding=(0, 2, 0, 0))
        table.add_column("Command", style="cyan bold", min_width=18)
        table.add_column("Description")

        for cmd in commands:
            table.add_row(cmd.name, cmd.description)

        _console.print(table)
        _console.print()
        _console.print("[dim]输入 'help <command>' 查看特定命令的详细帮助[/dim]")
        _console.print("[dim]输入 'exit' 或 'quit' 退出 CLI，'qq' 强制退出[/dim]")

        return CommandResult.ok("")

    def _show_command_help(self, command_name: str) -> CommandResult:
        command = self._registry.get(command_name)
        if command is None:
            return CommandResult.error(f"未知命令: {command_name}")

        return CommandResult.ok(command.help_text)
