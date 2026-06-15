"""
@fileoverview CLI Shell 项目管理命令模块

功能概述:
- 提供 project status 命令：显示当前项目的基本信息（路径、配置、数据源数量等）
- 提供 project history 命令：显示最近打开的项目列表
- 复用顶层 open 命令作为 project open 子命令，保持向后兼容
- 管理项目打开历史（持久化到 ~/.precis_project_history）

架构设计:
- ProjectCommand 作为聚合命令，包含 OpenCommand、StatusCommand、ProjectHistoryCommand 三个子命令
- OpenCommand 定义在 app.cli.shell.commands.open，被顶层和 project 子命令同时复用
- 子命令使用 subcommands 列表维护，execute() 方法根据第一个参数分发给对应子命令
- 历史记录使用 JSON 文件持久化，支持去重与容量限制（MAX_HISTORY = 10）

输入示例:
    open /path/to/project
    project open /path/to/project
    project status
    project history

输出示例:
    CommandResult(success=True, message="已切换到项目: /path/to/project")
    CommandResult(success=True, message="当前项目: demo")
    CommandResult(success=True, message="最近打开的项目: 1. /path/to/project")
"""

import os

from rich.console import Console
from rich.table import Table

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.commands.open import OpenCommand, _load_history

_console = Console()


class StatusCommand(Command):
    """查看项目状态命令。

    显示当前打开项目的基本信息，包括路径、清单文件状态、数据文件数量和历史项目数量。
    """

    def __init__(self):
        super().__init__("status", aliases=["st"])

    @property
    def description(self) -> str:
        return "显示当前项目的状态信息"

    @property
    def usage(self) -> str:
        return "project status"

    def execute(self, args: list[str], ctx: CommandContext) -> CommandResult:
        """执行查看项目状态命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            ctx: 命令上下文

        Returns:
            包含项目状态信息的命令执行结果
        """
        project_path = ctx.project_path
        if not project_path:
            return CommandResult(success=False, message="当前未选择任何项目。使用 'open <路径>' 或 'project open <路径>' 切换项目。")

        # 检查清单文件
        manifest_path = os.path.join(project_path, "project.precis.yaml")
        has_manifest = os.path.exists(manifest_path)

        # 统计数据目录中的文件数量
        data_dir = os.path.join(project_path, "data")
        data_file_count = 0
        if os.path.isdir(data_dir):
            data_file_count = sum(1 for f in os.listdir(data_dir) if os.path.isfile(os.path.join(data_dir, f)))

        # 统计历史记录数量
        history_count = len(_load_history())

        # 使用 rich table 渲染
        table = Table(show_header=False, box=None, padding=(0, 2))
        table.add_column("Key", style="dim")
        table.add_column("Value", style="bold")
        table.add_row("项目", os.path.basename(project_path))
        table.add_row("路径", project_path)
        table.add_row("项目清单", "[green]已找到[/green]" if has_manifest else "[yellow]未找到[/yellow]")
        table.add_row("数据文件", str(data_file_count) if data_file_count > 0 else "[dim]未找到[/dim]")
        table.add_row("历史项目", str(history_count))

        _console.print()
        _console.print(table)

        return CommandResult(success=True, message="")


class ProjectHistoryCommand(Command):
    """查看项目历史命令。

    显示最近打开的项目列表，按时间倒序排列。
    """

    def __init__(self):
        super().__init__("history", aliases=["h"])

    @property
    def description(self) -> str:
        return "显示最近打开的项目列表"

    @property
    def usage(self) -> str:
        return "project history"

    def execute(self, args: list[str], ctx: CommandContext) -> CommandResult:
        """执行查看项目历史命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            ctx: 命令上下文

        Returns:
            包含历史项目列表的命令执行结果
        """
        history = _load_history()
        if not history:
            return CommandResult(success=True, message="暂无项目打开历史。")

        lines = ["最近打开的项目:"]
        for i, item in enumerate(history, 1):
            path = item.get("path", "未知路径")
            lines.append(f"  {i}. {path}")

        return CommandResult(success=True, message="\n".join(lines))


class ProjectCommand(Command):
    """项目管理命令聚合器。

    作为 project 命令的总入口，负责将子命令分发给：
    - OpenCommand: 打开项目
    - StatusCommand: 查看状态
    - ProjectHistoryCommand: 查看历史
    """

    def __init__(self):
        super().__init__("project", aliases=["p"])
        self.add_subcommand("open", OpenCommand())
        self.add_subcommand("status", StatusCommand())
        self.add_subcommand("history", ProjectHistoryCommand())

    @property
    def description(self) -> str:
        return "项目管理相关命令（打开、状态、历史）"

    @property
    def usage(self) -> str:
        return "project <子命令>"

    def execute(self, args: list[str], ctx: CommandContext) -> CommandResult:
        """执行项目管理命令。

        根据第一个参数匹配对应的子命令并执行。
        如果没有参数，显示帮助信息。

        Args:
            args: 命令参数列表，第一个元素为子命令名
            ctx: 命令上下文

        Returns:
            子命令的执行结果，或错误提示
        """
        if not args:
            return self._show_help()

        # 子命令名匹配（支持名称或别名）
        sub_name = args[0].lower()
        for sub in self._subcommands.values():
            if sub_name == sub.name or sub_name in (a.lower() for a in sub.aliases):
                return sub.execute(args[1:], ctx)

        available = ", ".join(self.list_subcommands())
        return CommandResult(success=False, message=f"未知的 project 子命令: {sub_name}。可用子命令: {available}")

    def _show_help(self) -> CommandResult:
        """显示 project 命令的帮助信息。

        Returns:
            包含所有子命令说明的结果
        """
        lines = ["project - 项目管理命令", "用法: project <子命令>", "", "可用子命令:"]
        for name in self.list_subcommands():
            sub = self.get_subcommand(name)
            if sub:
                aliases_str = f" ({', '.join(sub.aliases)})" if sub.aliases else ""
                lines.append(f"  {sub.name}{aliases_str} - {sub.description}")
        return CommandResult(success=True, message="\n".join(lines))
