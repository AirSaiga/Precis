# backend/app/cli/shell/parser.py
"""
@fileoverview CLI Shell 命令解析与注册模块

功能概述:
- 管理所有可用命令的注册和查找
- 解析用户输入并分发到对应命令执行
- 支持引号包围的参数分割

架构设计:
- CommandRegistry 维护命令名称与别名的映射
- CommandParser 分割参数并查找对应命令
- CommandExecutor 协调解析与上下文执行
"""

from typing import Callable, Optional

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.exceptions import CommandNotFoundError


class CommandRegistry:
    """命令注册表。

    管理所有可用命令的注册和查找。
    """

    def __init__(self):
        self._commands: dict[str, Command] = {}
        self._aliases: dict[str, str] = {}

    def register(self, command: Command) -> None:
        """注册命令。

        Args:
            command: 命令实例
        """
        self._commands[command.name] = command
        for alias in command.aliases:
            self._aliases[alias] = command.name

    def unregister(self, name: str) -> None:
        """注销命令。

        Args:
            name: 命令名称
        """
        if name in self._commands:
            command = self._commands[name]
            for alias in command.aliases:
                self._aliases.pop(alias, None)
            self._commands.pop(name)

    def get(self, name: str) -> Optional[Command]:
        """获取命令。

        Args:
            name: 命令名称或别名

        Returns:
            命令实例，如果不存在则返回 None
        """
        if name in self._commands:
            return self._commands[name]
        if name in self._aliases:
            return self._commands[self._aliases[name]]
        return None

    def list_commands(self) -> list[str]:
        """列出所有注册的命令名称。"""
        return list(self._commands.keys())

    def get_all_commands(self) -> list[Command]:
        """获取所有已注册的命令。"""
        return list(self._commands.values())


class CommandParser:
    """命令解析器。

    解析用户输入并分发到对应命令执行。
    """

    def __init__(self, registry: CommandRegistry):
        self.registry = registry

    def parse(self, input_line: str) -> tuple[Optional[Command], list[str]]:
        """解析输入行。

        Args:
            input_line: 用户输入的行

        Returns:
            (命令实例, 参数列表) 元组
        """
        input_line = input_line.strip()
        if not input_line:
            return None, []

        parts = self._split_args(input_line)
        if not parts:
            return None, []

        command_name = parts[0]
        args = parts[1:]

        command = self.registry.get(command_name)
        if command is None:
            raise CommandNotFoundError(command_name)

        return command, args

    def _split_args(self, line: str) -> list[str]:
        """分割命令行参数。

        支持引号包围的参数。

        Args:
            line: 输入行

        Returns:
            参数列表
        """
        tokens: list[str] = []
        current: list[str] = []
        in_quote = False
        quote_char = None

        for char in line:
            if char in ('"', "'") and not in_quote:
                in_quote = True
                quote_char = char
            elif char == quote_char and in_quote:
                in_quote = False
                quote_char = None
            elif char == " " and not in_quote:
                if current:
                    tokens.append("".join(current))
                    current = []
            else:
                current.append(char)

        if current:
            tokens.append("".join(current))

        return tokens


class CommandExecutor:
    """命令执行器。

    负责执行解析后的命令。
    """

    def __init__(self, parser: CommandParser, context: ProjectContext):
        self.parser = parser
        self.context = context

    def execute(self, input_line: str) -> CommandResult:
        """执行命令。

        Args:
            input_line: 用户输入的行

        Returns:
            命令执行结果
        """
        try:
            command, args = self.parser.parse(input_line)
            if command is None:
                return CommandResult.error("请输入命令")

            return command.execute(args, self.context)
        except CommandNotFoundError as e:
            return CommandResult.error(str(e))
        except Exception as e:
            return CommandResult.error(f"命令执行失败: {e}")

    def execute_with_args(self, args: list[str]) -> CommandResult:
        """使用预分割参数列表执行命令。

        跳过 join/split 循环，保留参数中的空格（如文件路径）。

        Args:
            args: 预分割的参数列表，第一个元素为命令名

        Returns:
            命令执行结果
        """
        try:
            if not args:
                return CommandResult.error("请输入命令")

            command = self.parser.registry.get(args[0])
            if command is None:
                raise CommandNotFoundError(args[0])

            return command.execute(args[1:], self.context)
        except CommandNotFoundError as e:
            return CommandResult.error(str(e))
        except Exception as e:
            return CommandResult.error(f"命令执行失败: {e}")


def command(name: str, aliases: Optional[list[str]] = None) -> Callable:
    """命令装饰器。

    用于注册命令类的装饰器。

    Args:
        name: 命令名称
        aliases: 命令别名

    Returns:
        装饰器函数
    """

    def decorator(cls: type[Command]) -> type[Command]:
        cls.name = name
        cls.aliases = aliases or []
        return cls

    return decorator
