"""
@fileoverview CLI Shell 系统命令模块

功能概述:
- 提供 pwd 命令显示当前工作目录或已打开的项目路径
- 提供 ls 命令列出项目目录或指定路径下的文件和文件夹
- 支持相对路径和绝对路径，自动区分文件与目录并按名称排序

架构设计:
- PwdCommand 和 LsCommand 均继承自 Command 基类
- LsCommand 未指定路径时优先显示项目根目录，其次显示系统工作目录
- 使用 lambda 排序实现先文件夹后文件的展示效果

输入示例:
    precis> pwd
    precis> ls
    precis> ls ../data

输出示例:
    目录: D:/Project/Precis
      📁 backend/
      📁 frontend/
      📄 README.md
"""

import os

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext


class PwdCommand(Command):
    """显示当前工作路径命令。

    显示系统当前工作目录，如果已打开项目则同时显示项目路径。
    """

    def __init__(self):
        super().__init__("pwd", aliases=["cwd"])

    @property
    def description(self) -> str:
        return "显示当前工作目录或已打开的项目路径"

    @property
    def usage(self) -> str:
        return "pwd"

    @property
    def help_text(self) -> str:
        return "显示当前系统的工作目录路径。\n\n如果已经通过 'open' 命令打开了项目，它会同时显示当前项目所在的路径。"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行 pwd 命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            context: 项目上下文

        Returns:
            包含当前工作目录和项目路径的结果
        """
        cwd = os.getcwd()
        result_text = f"当前系统工作目录: {cwd}"

        if context.is_project_open:
            result_text += f"\n当前已打开项目路径: {context.project_path}"

        return CommandResult.ok(result_text)


class LsCommand(Command):
    """列出目录内容命令。

    列出指定目录下的文件和文件夹，未指定路径时默认显示项目根目录。
    支持相对路径和绝对路径。
    """

    def __init__(self):
        super().__init__("ls", aliases=["dir"])

    @property
    def description(self) -> str:
        return "列出当前目录下的文件"

    @property
    def usage(self) -> str:
        return "ls [path]"

    @property
    def help_text(self) -> str:
        return (
            "列出指定目录下的文件和文件夹列表。\n\n"
            "如果没有提供 path 参数：\n"
            "  - 若已打开项目，将列出项目根目录的内容。\n"
            "  - 若未打开项目，将列出当前系统工作目录的内容。\n\n"
            "示例:\n"
            "  ls              (列出当前或项目目录)\n"
            "  ls ../data      (列出相对路径目录)\n"
            "  ls /var/log     (列出绝对路径目录)"
        )

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行 ls 命令。

        Args:
            args: 命令参数列表，可能包含要列出的路径
            context: 项目上下文

        Returns:
            包含目录内容的格式化结果，或错误提示
        """
        if args:
            target_path = args[0]
        elif context.is_project_open:
            project_path = context.project_path
            if project_path is None:
                target_path = os.getcwd()
            else:
                target_path = project_path
        else:
            target_path = os.getcwd()

        # 展开用户主目录符号（如 ~）并转换为绝对路径
        target_path = os.path.abspath(os.path.expanduser(target_path))

        if not os.path.exists(target_path):
            return CommandResult.error(f"路径不存在: {target_path}")

        if not os.path.isdir(target_path):
            return CommandResult.error(f"非目录路径: {target_path}")

        try:
            items = os.listdir(target_path)
            # 排序逻辑：先文件夹后文件，然后按名称字母顺序排序
            items.sort(key=lambda x: (not os.path.isdir(os.path.join(target_path, x)), x.lower()))

            output = []
            output.append(f"目录: {target_path}\n")

            for item in items:
                item_path = os.path.join(target_path, item)
                if os.path.isdir(item_path):
                    output.append(f"  📁 {item}/")
                else:
                    output.append(f"  📄 {item}")

            if not items:
                output.append("  (空目录)")

            return CommandResult.ok("\n".join(output))

        except PermissionError:
            return CommandResult.error(f"没有权限读取目录: {target_path}")
        except Exception as e:
            return CommandResult.error(f"无法读取目录: {str(e)}")
