# backend/app/cli/shell/commands/ai/delete.py
"""
@fileoverview AI Provider 删除命令模块

功能概述:
- 提供 ai delete 子命令删除已配置的 AI Provider API Key
- 支持交互式菜单选择与直接指定 Provider ID 删除
- 删除前要求用户确认，防止误操作

架构设计:
- AIDeleteCommand 继承 Command 基类
- execute() 根据是否有参数决定交互式删除或直接删除
- 通过 CLI 配置管理器删除 Provider 配置

输入示例:
    ai delete
    ai delete openai

输出示例:
    CommandResult.ok("API Key 已删除")
    CommandResult.error("没有已配置的 API Key")
"""

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.config_storage import get_cli_config
from app.cli.shell.formatter import Colors, Formatter
from app.cli.shell.interactive_menu import InteractiveMenu


class AIDeleteCommand(Command):
    """删除已配置的 AI Provider API Key 命令。

    支持交互式选择或直接指定 Provider ID 删除。
    删除前会要求用户确认。
    """

    def __init__(self):
        super().__init__("delete")
        self._cli_config = get_cli_config()

    @property
    def description(self) -> str:
        return "删除 AI Provider"

    @property
    def usage(self) -> str:
        return "ai delete [provider_id]"

    @property
    def help_text(self) -> str:
        return """
用法: ai delete [provider_id]

示例:
  ai delete           # 交互式选择要删除的 Provider
  ai delete openai   # 直接删除 OpenAI

说明:
  删除指定的 Provider 配置。
  使用 'ai status' 查看已配置的 Provider。
        """.strip()

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行删除命令。

        Args:
            args: 命令参数列表，可能包含 Provider ID
            context: 命令上下文

        Returns:
            删除成功或失败的结果
        """
        providers = self._cli_config.list_providers()

        if not providers:
            return CommandResult.error("没有已配置的 Provider\n请使用 'ai setup' 进行配置")

        if not args:
            return self._interactive_delete(providers)

        provider_id = args[0].lower()
        return self._do_delete(provider_id, providers)

    def _interactive_delete(self, providers: list) -> CommandResult:
        """交互式删除 Provider（支持方向键导航）。

        显示菜单让用户选择要删除的 Provider。

        Args:
            providers: 已配置的 Provider 列表

        Returns:
            删除结果或取消结果
        """
        print(Formatter.header("\n删除 Provider"))

        menu = InteractiveMenu("请选择要删除的 Provider:")

        for p in providers:
            label = f"{p.name} ({p.model})"
            menu.add_item(p.id, label, "")

        menu.add_item("_cancel_", "取消", "返回")

        provider_id = menu.show()

        if provider_id is None or provider_id == "_cancel_":
            return CommandResult.ok("已取消")

        return self._do_delete(provider_id, providers)

    def _do_delete(self, provider_id: str, providers: list) -> CommandResult:
        """执行删除操作。

        验证 Provider 存在，然后要求用户确认后删除。

        Args:
            provider_id: 要删除的 Provider ID
            providers: 已配置的 Provider 列表

        Returns:
            删除成功或失败的结果
        """
        provider = self._cli_config.get_provider(provider_id)
        if not provider:
            return CommandResult.error(f"Provider '{provider_id}' 未配置\n使用 'ai status' 查看已配置的 Provider")

        print(Formatter.warning(f"\n警告: 将删除 {provider.name} ({provider.id})"))
        print(Formatter.info(f"  模型: {provider.model}\n"))

        try:
            confirm = input(Formatter.colorize("确认删除? (y/N): ", Colors.YELLOW)).strip().lower()
        except (KeyboardInterrupt, EOFError):
            print()
            return CommandResult.ok("已取消")

        if confirm not in ("y", "yes"):
            return CommandResult.ok("已取消")

        if self._cli_config.delete_provider(provider_id):
            print(Formatter.success(f"\n[*] {provider.name} 已删除"))
            return CommandResult.ok("Provider 已删除")
        else:
            return CommandResult.error("删除失败")
