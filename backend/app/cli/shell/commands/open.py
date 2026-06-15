# backend/app/cli/shell/commands/open.py
"""
@fileoverview CLI Shell 打开项目命令模块

功能概述:
- 提供 open 命令：打开并切换工作项目，维护项目历史记录
- 管理项目打开历史（持久化到 ~/.precis_project_history）

架构设计:
- OpenCommand 作为顶层命令注册，同时被 ProjectCommand 复用为子命令
- 历史记录使用 JSON 文件持久化，支持去重与容量限制（MAX_HISTORY = 10）
- 错误处理通过 CommandResult.error 直接返回，不抛出异常

输入示例:
    open /path/to/project
    project open /path/to/project

输出示例:
    CommandResult(success=True, message="已切换到项目: /path/to/project")
"""

import json
import logging
import os

from app.cli.shell.commands.base import Command, CommandContext, CommandResult

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
        return "open <项目路径>"

    def execute(self, args: list[str], ctx: CommandContext) -> CommandResult:
        """执行打开项目命令。

        Args:
            args: 命令参数列表，第一个元素应为项目路径
            ctx: 命令上下文，用于保存当前项目路径

        Returns:
            命令执行结果
        """
        if not args:
            return CommandResult(success=False, message="错误：缺少项目路径参数。用法: open <项目路径>")

        # 转换为绝对路径，确保路径一致性
        project_path = os.path.abspath(args[0])

        if not os.path.exists(project_path):
            return CommandResult(success=False, message=f"项目路径不存在: {project_path}")
        if not os.path.isdir(project_path):
            return CommandResult(success=False, message=f"路径不是目录: {project_path}")

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
