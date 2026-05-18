"""
@fileoverview CLI Shell 项目管理命令模块

功能概述:
- 提供 project open 命令：打开并切换工作项目，维护项目历史记录
- 提供 project status 命令：显示当前项目的基本信息（路径、配置、数据源数量等）
- 提供 project history 命令：显示最近打开的项目列表
- 管理项目打开历史（持久化到 ~/.precis_project_history）

架构设计:
- ProjectCommand 作为聚合命令，包含 OpenCommand、StatusCommand、ProjectHistoryCommand 三个子命令
- 子命令使用 subcommands 列表维护，execute() 方法根据第一个参数分发给对应子命令
- 历史记录使用 JSON 文件持久化，支持去重与容量限制（MAX_HISTORY = 10）
- 错误处理通过自定义异常类（InvalidProjectError, ProjectNotFoundError）向上传递

输入示例:
    project open /path/to/project
    project status
    project history

输出示例:
    CommandResult(success=True, message="已切换到项目: /path/to/project")
    CommandResult(success=True, message="当前项目: demo")
    CommandResult(success=True, message="最近打开的项目: 1. /path/to/project")
"""

import logging
import os

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.exceptions import InvalidProjectError, ProjectNotFoundError

# 历史记录文件路径：存储在用户主目录下
HISTORY_FILE = os.path.expanduser("~/.precis_project_history")
# 最大历史记录数量，超过时会自动丢弃最旧的项目
MAX_HISTORY = 10


def _load_history() -> list[dict]:
    """加载项目打开历史。

    从 ~/.precis_project_history 文件中读取历史记录。
    如果文件不存在、格式损坏或权限不足，返回空列表。

    Returns:
        历史记录列表，每个元素为包含 path 和 last_opened 的字典
    """
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        import json

        with open(HISTORY_FILE, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        # JSON 格式损坏，返回空列表
        return []
    except PermissionError:
        # 无权限读取，返回空列表
        return []
    except OSError:
        # 其他操作系统错误（如文件被锁定），返回空列表
        return []


def _save_history(history: list[dict]) -> None:
    """保存项目打开历史。

    将历史记录写入 ~/.precis_project_history 文件。

    Args:
        history: 历史记录列表
    """
    try:
        import json

        # 确保目录存在（用户主目录）
        os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except (PermissionError, OSError):
        # 保存失败时记录错误日志，但不阻断主流程
        logging.error("保存项目历史记录失败", exc_info=True)


def _add_to_history(project_path: str) -> None:
    """将项目路径添加到历史记录顶部。

    如果路径已存在，先移除旧记录，再插入到顶部。
    超过最大容量时自动截断。

    Args:
        project_path: 项目的绝对路径
    """
    history = _load_history()
    # 去重：移除已存在的相同路径
    history = [h for h in history if h.get("path") != project_path]
    # 插入到列表头部（最新的项目）
    history.insert(0, {"path": project_path, "last_opened": None})
    # 容量控制：只保留最近的 MAX_HISTORY 个项目
    if len(history) > MAX_HISTORY:
        history = history[:MAX_HISTORY]
    _save_history(history)


class OpenCommand(Command):
    """打开项目命令。

    接收一个项目路径参数，验证路径存在且为目录后，
    更新上下文并添加到历史记录。
    """

    def __init__(self):
        super().__init__("open", aliases=["o"])

    @property
    def description(self) -> str:
        return "打开一个项目目录并切换当前上下文"

    @property
    def usage(self) -> str:
        return "project open <项目路径>"

    def execute(self, args: list[str], ctx: CommandContext) -> CommandResult:
        """执行打开项目命令。

        Args:
            args: 命令参数列表，第一个元素应为项目路径
            ctx: 命令上下文，用于保存当前项目路径

        Returns:
            命令执行结果

        Raises:
            ProjectNotFoundError: 当项目路径不存在时抛出
            InvalidProjectError: 当路径不是目录时抛出
        """
        if not args:
            return CommandResult(success=False, message="错误：缺少项目路径参数。用法: project open <项目路径>")

        # 转换为绝对路径，确保路径一致性
        project_path = os.path.abspath(args[0])

        if not os.path.exists(project_path):
            raise ProjectNotFoundError(f"项目路径不存在: {project_path}")
        if not os.path.isdir(project_path):
            raise InvalidProjectError(f"路径不是目录: {project_path}")

        # 更新上下文中的项目路径
        ctx.project_path = project_path
        # 添加到历史记录
        _add_to_history(project_path)

        # 检查项目目录中是否存在清单文件
        manifest_path = os.path.join(project_path, "project.precis.yaml")
        has_manifest = os.path.exists(manifest_path)

        msg = f"已切换到项目: {project_path}"
        if has_manifest:
            msg += "\n检测到项目清单文件 (project.precis.yaml)"
        else:
            msg += "\n警告：未找到 project.precis.yaml，可能需要初始化项目"

        return CommandResult(success=True, message=msg)


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
            return CommandResult(success=False, message="当前未选择任何项目。使用 'project open <路径>' 切换项目。")

        # 构建状态信息行
        lines = [f"当前项目: {os.path.basename(project_path)}", f"路径: {project_path}"]

        # 检查清单文件
        manifest_path = os.path.join(project_path, "project.precis.yaml")
        if os.path.exists(manifest_path):
            lines.append("项目清单: 已找到")
        else:
            lines.append("项目清单: 未找到")

        # 统计数据目录中的文件数量
        data_dir = os.path.join(project_path, "data")
        if os.path.isdir(data_dir):
            files = [f for f in os.listdir(data_dir) if os.path.isfile(os.path.join(data_dir, f))]
            lines.append(f"数据文件数量: {len(files)}")
        else:
            lines.append("数据目录: 未找到")

        # 统计历史记录数量
        history = _load_history()
        history_count = len(history)
        lines.append(f"历史项目数量: {history_count}")

        return CommandResult(success=True, message="\n".join(lines))


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
        self.subcommands = [
            OpenCommand(),
            StatusCommand(),
            ProjectHistoryCommand(),
        ]

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
        for sub in self.subcommands:
            if sub_name == sub.name or sub_name in (a.lower() for a in sub.aliases):
                return sub.execute(args[1:], ctx)

        return CommandResult(
            success=False, message=f"未知的 project 子命令: {sub_name}。可用子命令: open, status, history"
        )

    def _show_help(self) -> CommandResult:
        """显示 project 命令的帮助信息。

        Returns:
            包含所有子命令说明的结果
        """
        lines = ["project - 项目管理命令", "用法: project <子命令>", "", "可用子命令:"]
        for sub in self.subcommands:
            aliases_str = f" ({', '.join(sub.aliases)})" if sub.aliases else ""
            lines.append(f"  {sub.name}{aliases_str} - {sub.description}")
        return CommandResult(success=True, message="\n".join(lines))
