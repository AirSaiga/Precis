# backend/app/cli/shell/main.py
"""
@fileoverview CLI Shell 主循环模块

功能概述:
- 提供交互式命令行 Shell 主循环
- 管理命令注册、解析和执行
- 支持初始参数直接执行与持续交互模式

架构设计:
- CLIShell 类管理命令注册表和项目上下文
- CommandParser 解析输入，CommandExecutor 执行命令
- 支持全局快捷退出命令（exit!, quit!, qq）
"""

import logging
import sys
from typing import Optional

from app.cli.shell.commands import (
    AICommand,
    ConfigCommand,
    ExitCommand,
    HelpCommand,
    LsCommand,
    OpenCommand,
    PwdCommand,
    SetupCommand,
    StatusCommand,
    ValidateCommand,
)
from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.exceptions import CLIError
from app.cli.shell.formatter import Colors, Formatter
from app.cli.shell.parser import CommandExecutor, CommandParser, CommandRegistry


def _setup_logging() -> None:
    """配置日志级别，CLI 模式下只显示警告及以上级别。"""
    import os

    debug_mode = os.environ.get("PRECIS_DEBUG", "").lower() in ("1", "true", "yes")
    level = logging.DEBUG if debug_mode else logging.WARNING
    logging.basicConfig(level=level, format="%(levelname)s: %(message)s", handlers=[logging.StreamHandler(sys.stderr)])


def _setup_encoding() -> None:
    """确保 stdout/stderr 使用 UTF-8 编码。

    Windows 中文环境的默认终端编码为 GBK (cp936)，
    无法输出 Unicode 字符（如 Spinner 动画帧、校验结果中的符号等）。
    将 stdout/stderr 重新配置为 UTF-8，errors 策略为 replace，避免编码异常。
    """
    if sys.platform == "win32":
        for stream in (sys.stdout, sys.stderr):
            if stream and hasattr(stream, "reconfigure"):
                try:
                    stream.reconfigure(encoding="utf-8", errors="replace")
                except (AttributeError, OSError):
                    pass


class CLIShell:
    """CLI Shell 主类。

    管理命令注册和交互式主循环。
    """

    def __init__(self):
        self.registry = CommandRegistry()
        self.context = ProjectContext()
        self._setup_commands()

    def _setup_commands(self) -> None:
        """注册所有内置命令。"""
        self.registry.register(HelpCommand(self.registry))
        self.registry.register(OpenCommand())
        self.registry.register(StatusCommand())
        self.registry.register(ValidateCommand())
        self.registry.register(ConfigCommand())
        self.registry.register(SetupCommand())
        self.registry.register(AICommand())
        self.registry.register(PwdCommand())
        self.registry.register(LsCommand())
        self.registry.register(ExitCommand())

    def run(self, initial_args: Optional[list] = None) -> int:
        """运行 CLI Shell。

        Args:
            initial_args: 初始参数，如果提供则执行后退出

        Returns:
            退出码
        """
        parser = CommandParser(self.registry)
        executor = CommandExecutor(parser, self.context)

        if initial_args:
            input_line = " ".join(initial_args)
            # 全局快捷退出命令
            if input_line.lower() in ("exit!", "quit!", "qq"):
                print(Formatter.success("再见!"))
                sys.exit(0)
            result = executor.execute(input_line)
            if result.message:
                if result.success:
                    print(result.message)
                else:
                    Formatter.print_error(result.message)
            # 单次执行模式：命令失败返回 1，成功返回 0
            # 这对 CI/CD 自动化至关重要，流水线通过退出码判断校验是否通过
            return 0 if result.success else 1

        Formatter.print_welcome()

        while True:
            try:
                prompt = self._get_prompt()
                # 主循环使用普通 input 保持颜色，get_input_cached 只用于 AI chat
                input_line = input(prompt).strip()

                if not input_line:
                    continue

                # 全局快捷退出命令
                if input_line.lower() in ("exit!", "quit!", "qq"):
                    print(Formatter.success("再见!"))
                    sys.exit(0)

                result = self._execute_line(executor, input_line)

                if result != 0:
                    return result

            except KeyboardInterrupt:
                print()
                print(Formatter.info("使用 'exit' 或 'quit' 退出，'qq' 直接退出程序"))
            except EOFError:
                print()
                print(Formatter.success("再见!"))
                return 0

    def _execute_line(self, executor: CommandExecutor, input_line: str) -> int:
        """执行一行输入。

        Args:
            executor: 命令执行器
            input_line: 输入行

        Returns:
            退出码，0 表示继续， 非0 表示退出
        """
        result = executor.execute(input_line)

        if result.message:
            if result.success:
                print(result.message)
            else:
                Formatter.print_error(result.message)

        if result.should_exit:
            return 1

        return 0

    def _get_prompt(self) -> str:
        """获取命令提示符。"""
        if self.context.is_project_open:
            project_name = self.context.project_config.get("project", {}).get("name", "project")
            return Formatter.colorize(f"precis:{project_name}> ", Colors.CYAN)
        return Formatter.colorize("precis> ", Colors.CYAN)


def main(args: Optional[list] = None) -> int:
    """CLI 主入口函数。

    Args:
        args: 命令行参数列表，默认为 sys.argv[1:]

    Returns:
        退出码
    """
    _setup_encoding()
    _setup_logging()

    if args is None:
        args = sys.argv[1:]

    try:
        shell = CLIShell()
        return shell.run(args)
    except CLIError as e:
        Formatter.print_error(e.message)
        return e.exit_code
    except Exception as e:
        Formatter.print_error(f"未预期的错误: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
