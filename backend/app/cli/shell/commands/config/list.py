# backend/app/cli/shell/commands/config/list.py
"""
@fileoverview 配置列表命令模块

功能概述:
- 提供 config list 子命令列出项目中所有 YAML 配置文件
- 递归扫描 schemas、constraints、patterns、regex 目录
- 格式化显示文件名与大小

架构设计:
- ConfigListCommand 继承 Command 基类
- 先扫描项目根目录，再递归扫描子目录
- _format_size(): 将字节转换为人类可读格式（B/KB/MB）

输入示例:
    config list

输出示例:
    配置文件列表表格
"""

from app.cli.shared_services.config_ops import list_config_files
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.formatter import Formatter


class ConfigListCommand(Command):
    """列出配置命令。

    显示项目中所有 YAML 配置文件及其大小。
    """

    def __init__(self):
        super().__init__("list")

    @property
    def description(self) -> str:
        return "列出项目中的所有配置文件"

    @property
    def usage(self) -> str:
        return "config list"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行列出配置命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            context: 项目上下文

        Returns:
            配置文件列表或提示信息
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        # 扫描配置文件（委托 shared_services 纯逻辑，CLI/TUI 同源）
        config_files = list_config_files(project_path)

        if not config_files:
            return CommandResult.ok("暂无配置文件")

        output_lines = [Formatter.header("\n配置文件列表:")]
        output_lines.append(f"{'文件名':<40} {'大小':>10}")
        output_lines.append("-" * 52)

        for cf in config_files:
            size_str = self._format_size(cf.size)
            output_lines.append(f"{cf.name:<40} {size_str:>10}")

        output_lines.append(f"\n共 {len(config_files)} 个配置文件")
        return CommandResult.ok("\n".join(output_lines))

    def _format_size(self, size: int) -> str:
        """格式化文件大小。

        Args:
            size: 文件大小（字节）

        Returns:
            人类可读的字符串，如 "1.5KB"
        """
        if size < 1024:
            return f"{size}B"
        elif size < 1024 * 1024:
            return f"{size / 1024:.1f}KB"
        else:
            return f"{size / (1024 * 1024):.1f}MB"
