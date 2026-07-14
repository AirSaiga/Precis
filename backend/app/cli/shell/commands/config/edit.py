# backend/app/cli/shell/commands/config/edit.py
"""
@fileoverview 配置编辑命令模块

功能概述:
- 提供 config edit 子命令调用系统编辑器修改配置文件
- 自动检测 EDITOR/VISUAL 环境变量，支持跨平台编辑器
- 未指定文件时默认编辑 project.precis.yaml

架构设计:
- ConfigEditCommand 继承 Command 基类
- _get_editor(): 按优先级查找合适的编辑器
- 使用 subprocess.run 启动编辑器进程，等待用户关闭

输入示例:
    config edit
    config edit constraints.yaml

输出示例:
    CommandResult.ok("已保存配置文件: project.precis.yaml")
    CommandResult.error("未找到编辑器: notepad")
"""

import os
import subprocess
import sys

from app.cli.shared_services.config_ops import find_config_file
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.exceptions import EditorError


class ConfigEditCommand(Command):
    """编辑配置命令。

    调用系统默认编辑器打开项目配置文件。
    """

    def __init__(self):
        super().__init__("edit")

    @property
    def description(self) -> str:
        return "使用编辑器编辑项目的配置文件"

    @property
    def usage(self) -> str:
        return "config edit [config_file]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行编辑命令。

        Args:
            args: 命令参数列表，可能包含要编辑的文件名
            context: 项目上下文

        Returns:
            编辑成功或失败的结果

        Raises:
            EditorError: 当编辑器发生异常时抛出
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        config_file = args[0] if args else "project.precis.yaml"
        config_path = find_config_file(project_path, config_file)

        if not config_path:
            # 列出可用的配置文件
            available = []
            for root, _, files in os.walk(project_path):
                # 跳过隐藏目录
                if any(part.startswith(".") for part in root.split(os.sep)):
                    continue
                for f in files:
                    if f.endswith((".yaml", ".yml")):
                        rel_path = os.path.relpath(os.path.join(root, f), project_path)
                        available.append(rel_path)

            return CommandResult.error(
                f"配置文件不存在: {config_file}\n"
                f"可用配置文件: {', '.join(available[:10]) if available else '无'}"
                f"{'...' if len(available) > 10 else ''}"
            )

        editor = self._get_editor()

        try:
            result = subprocess.run(
                [editor, config_path],
                cwd=project_path,
            )

            if result.returncode != 0:
                return CommandResult.error(f"编辑器退出码: {result.returncode}")

            return CommandResult.ok(f"已保存配置文件: {config_file}")

        except FileNotFoundError:
            return CommandResult.error(f"未找到编辑器: {editor}")
        except Exception as e:
            raise EditorError(str(e))

    def _get_editor(self) -> str:
        """获取编辑器路径。

        按以下优先级查找：
        1. EDITOR 环境变量
        2. VISUAL 环境变量
        3. Windows: notepad
        4. Linux/macOS: vim, nano, vi

        Returns:
            编辑器可执行文件路径或名称
        """
        for env_var in ["EDITOR", "VISUAL"]:
            editor = os.environ.get(env_var)
            if editor:
                return editor

        if sys.platform == "win32":
            return "notepad"

        for editor in ["vim", "nano", "vi"]:
            try:
                subprocess.run(["which", editor], capture_output=True, check=True)
                return editor
            except subprocess.CalledProcessError:
                continue

        return "vim"
