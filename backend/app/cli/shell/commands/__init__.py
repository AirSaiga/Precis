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
from app.cli.shell.commands.project import OpenCommand, ProjectCommand, StatusCommand
from app.cli.shell.commands.setup import SetupCommand
from app.cli.shell.commands.system import LsCommand, PwdCommand
from app.cli.shell.commands.validate import ValidateCommand

__all__ = [
    "Command",
    "CommandResult",
    "HelpCommand",
    "OpenCommand",
    "ProjectCommand",
    "StatusCommand",
    "ValidateCommand",
    "ConfigCommand",
    "ExitCommand",
    "SetupCommand",
    "AICommand",
    "PwdCommand",
    "LsCommand",
]
