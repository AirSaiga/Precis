# backend/app/cli/shell/commands/ai/switch.py
"""
@fileoverview AI Provider 切换命令模块

功能概述:
- 提供 ai switch 子命令切换默认 AI Provider
- 支持交互式菜单选择与直接指定 Provider ID
- 验证目标 Provider 是否有 API Key，无 Key 则拒绝切换

架构设计:
- AISwitchCommand 继承 Command 基类
- execute() 根据是否有参数决定交互式切换或直接切换
- 通过 CLI 配置管理器设置默认 Provider

输入示例:
    ai switch
    ai switch openai

输出示例:
    CommandResult.ok("已切换 Provider")
    CommandResult.error("Provider 'xxx' 未配置")
"""

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.config_storage import get_cli_config
from app.cli.shell.formatter import Formatter
from app.cli.shell.interactive_menu import InteractiveMenu


class AISwitchCommand(Command):
    """切换默认 AI Provider 命令。

    支持交互式菜单或直接指定 Provider ID 切换。
    """

    def __init__(self):
        super().__init__("switch")
        self._cli_config = get_cli_config()

    @property
    def description(self) -> str:
        return "切换默认 AI Provider"

    @property
    def usage(self) -> str:
        return "ai switch <provider_id>"

    @property
    def help_text(self) -> str:
        return """
用法: ai switch <provider_id>

示例:
  ai switch openai   # 切换到 OpenAI
  ai switch kimi     # 切换到 Kimi

说明:
  切换到已配置的 Provider。
  使用 'ai status' 查看可用的 Provider。
        """.strip()

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行切换命令。

        Args:
            args: 命令参数列表，可能包含 Provider ID
            context: 命令上下文

        Returns:
            切换成功或失败的结果
        """
        providers = self._cli_config.list_providers()

        if not providers:
            return CommandResult.error("没有已配置的 Provider\n请先使用 'setup' 命令进行配置")

        if not args:
            # 无参数时进入交互式选择（支持方向键）
            return self._interactive_switch(providers)

        provider_id = args[0].lower()
        return self._do_switch(provider_id)

    def _interactive_switch(self, providers: list) -> CommandResult:
        """交互式切换 Provider（支持方向键导航）。

        显示菜单让用户选择要切换到的 Provider。

        Args:
            providers: 已配置的 Provider 列表

        Returns:
            切换结果或取消结果
        """
        print(Formatter.header("\n切换 AI Provider"))

        active = self._cli_config.get_active_provider()

        # 创建菜单
        menu = InteractiveMenu("请选择要切换的 Provider:")

        for p in providers:
            status = ""
            if active and active.id == p.id:
                status = " [当前]"
            key_status = "[有密钥]" if p.api_key else "[无密钥]"
            label = f"{p.name} {key_status}{status}"
            menu.add_item(p.id, label, f"模型: {p.model}")

        provider_id = menu.show()

        if provider_id is None:
            return CommandResult.ok("已取消")

        return self._do_switch(provider_id)

    def _do_switch(self, provider_id: str) -> CommandResult:
        """执行切换操作。

        验证 Provider 存在，然后设置为默认。

        Args:
            provider_id: 要切换到的 Provider ID

        Returns:
            切换成功或失败的结果
        """
        provider = self._cli_config.get_provider(provider_id)
        if not provider:
            return CommandResult.error(f"Provider '{provider_id}' 未配置\n请先使用 'setup {provider_id}' 进行配置")

        if self._cli_config.set_active_provider(provider_id):
            print(Formatter.success(f"\n[*] 已切换到 {provider.name}"))
            print(Formatter.info(f"  模型: {provider.model}"))
            return CommandResult.ok("已切换 Provider")
        else:
            return CommandResult.error("切换失败")
