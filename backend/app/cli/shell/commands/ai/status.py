# backend/app/cli/shell/commands/ai/status.py
"""
@fileoverview AI 配置状态命令模块

功能概述:
- 提供 ai status 子命令显示当前 AI Provider 配置状态
- 列出所有已配置 Provider，标记当前默认项与密钥状态
- 显示 Provider 的模型、端点等信息

架构设计:
- AIStatusCommand 继承 Command 基类
- 通过 CLI 配置管理器获取 Provider 列表和默认项
- 使用 Formatter 进行颜色高亮输出

输入示例:
    ai status

输出示例:
    带颜色高亮的 Provider 配置状态文本
"""

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.config_storage import get_cli_config
from app.cli.shell.formatter import Formatter


class AIStatusCommand(Command):
    """AI 配置状态命令。

    显示所有已配置的 AI Provider 及其状态信息。
    """

    def __init__(self):
        super().__init__("status")
        self._cli_config = get_cli_config()

    @property
    def description(self) -> str:
        return "显示 AI 配置状态"

    @property
    def usage(self) -> str:
        return "ai status"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行状态查看命令。

        Args:
            args: 命令参数列表（此命令不需要参数）
            context: 项目上下文

        Returns:
            格式化的配置状态文本
        """
        providers = self._cli_config.list_providers()

        lines = [Formatter.header("\nCLI AI 配置状态")]

        if not providers:
            lines.append(Formatter.warning("\n未配置任何 AI Provider"))
            lines.append(Formatter.info("请编辑 ~/.precis/ai_providers.yaml 配置文件"))
        else:
            lines.append(f"\n已配置的 Providers ({len(providers)}):")
            active = self._cli_config.get_active_provider()

            for p in providers:
                is_active = active and active.id == p.id
                status_icon = "*" if is_active else " "
                has_key = "[有密钥]" if p.api_key else "[无密钥]"

                lines.append(f"\n  [{status_icon}] {p.name} ({p.id})")
                lines.append(f"     模型: {p.model}")
                lines.append(f"     API Key: {has_key}")
                if p.base_url:
                    lines.append(f"     端点: {p.base_url}")

            if active:
                lines.append("\n" + Formatter.success("[*] 当前默认: " + active.name))
            else:
                lines.append("\n" + Formatter.warning("[!] 没有可用的默认 Provider"))

        lines.append(Formatter.info("\n配置文件: ~/.precis/ai_providers.yaml"))
        lines.append(Formatter.info("API Key 设置方式: 环境变量"))
        lines.append(Formatter.info("  例如: OPENAI_API_KEY=sk-xxx"))

        return CommandResult.ok("\n".join(lines))
