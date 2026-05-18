# backend/app/cli/shell/commands/setup.py
"""
@fileoverview CLI Setup 命令模块

功能概述:
- 提供 setup 命令查看 AI Provider 配置模板和路径
- 支持热重载 ai_providers.json 配置文件
- 显示已配置 Provider 列表与默认设置

架构设计:
- SetupCommand 继承 Command 基类
- execute() 根据参数分发到 _reload_providers_config() 或 _show_config_info()
- 通过 config_storage 模块读取和重载配置

输入示例:
    precis> setup
    precis> setup reload

输出示例:
    配置信息文本或重载结果
"""

from pathlib import Path

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.config_storage import (
    get_cli_config,
    reload_providers_config,
)
from app.cli.shell.formatter import Formatter


class SetupCommand(Command):
    """Setup 命令 - 查看 AI Provider 配置信息。

    显示配置文件路径、已配置的 Provider 列表，以及配置模板示例。
    支持 reload 子命令热重载配置。
    """

    def __init__(self):
        super().__init__("setup", aliases=["config"])
        self._config = get_cli_config()

    @property
    def description(self) -> str:
        return "查看 AI Provider 配置信息"

    @property
    def usage(self) -> str:
        return "setup [reload]"

    @property
    def help_text(self) -> str:
        return """
用法: setup [reload]

说明:
  AI Provider 配置完全由用户手动控制。
  编辑 ~/.precis/ai_providers.json 配置文件来添加或修改 Provider。

子命令:
  setup              # 显示配置文件路径和模板示例
  setup reload       # 热重载 ai_providers.json 配置

配置文件格式示例:
  {
    "version": "2.0",
    "providers": [
      {
        "id": "openai",
        "name": "OpenAI",
        "type": "openai",
        "base_url": "https://api.openai.com/v1",
        "api_key": "${OPENAI_API_KEY}",
        "model": "gpt-4o"
      }
    ],
    "defaults": {
      "chat": "openai"
    }
  }

字段说明:
  - id: 唯一标识
  - name: 显示名称
  - type: "openai" 或 "ollama"
  - base_url: API 基础 URL
  - api_key: API 密钥，支持 ${ENV_VAR} 环境变量替换，本地服务可为 null
  - model: 默认模型名称
  - defaults.chat: 默认使用的 Provider ID
        """.strip()

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行 setup 命令。

        Args:
            args: 命令参数列表，可能包含 reload
            context: 命令上下文

        Returns:
            配置信息或重载结果
        """
        if args and args[0].lower() == "reload":
            return self._reload_providers_config()

        return self._show_config_info()

    def _reload_providers_config(self) -> CommandResult:
        """热重载 Provider 配置文件。

        调用 reload_providers_config() 重新读取配置文件，
        并显示重载后的 Provider 列表。

        Returns:
            重载成功或失败的结果
        """
        print(Formatter.header("\n热重载 Provider 配置"))

        config_path = Path.home() / ".precis" / "ai_providers.json"
        print(Formatter.info(f"配置文件: {config_path}"))

        if reload_providers_config():
            providers = self._config.list_providers()
            if providers:
                print(Formatter.success("\n[*] 配置重载成功！"))
                print(Formatter.info(f"  已配置 {len(providers)} 个 Provider:"))
                for p in providers:
                    print(f"    - {p.id}: {p.name} ({p.model})")
            else:
                print(Formatter.warning("\n[!] 配置文件为空，请先编辑配置文件添加 Provider"))
            return CommandResult.ok("配置已更新")
        else:
            return CommandResult.error(
                "配置重载失败，请检查文件格式是否正确。\n提示: 配置文件必须是有效的 JSON 格式，包含 'providers' 字段。"
            )

    def _show_config_info(self) -> CommandResult:
        """显示配置信息。

        显示配置文件路径、已配置的 Provider 列表以及配置模板。

        Returns:
            配置信息文本
        """
        print(Formatter.header("\nAI Provider 配置"))

        config_path = Path.home() / ".precis" / "ai_providers.json"
        print(Formatter.info(f"配置文件路径: {config_path}"))

        providers = self._config.list_providers()
        if providers:
            print(Formatter.success(f"\n[*] 当前已配置 {len(providers)} 个 Provider"))
            active = self._config.get_active_provider()
            for p in providers:
                is_active = active and active.id == p.id
                marker = " (默认)" if is_active else ""
                print(f"    - {p.id}: {p.name} ({p.model}){marker}")
        else:
            print(Formatter.warning("\n[!] 当前未配置任何 Provider"))

        print(Formatter.info("\n配置模板:"))
        print(
            """
{
  "version": "2.0",
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "type": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "${OPENAI_API_KEY}",
      "model": "gpt-4o"
    },
    {
      "id": "ollama-local",
      "name": "本地 Ollama",
      "type": "ollama",
      "base_url": "http://localhost:11434",
      "api_key": null,
      "model": "llama3.2"
    }
  ],
  "defaults": {
    "chat": "openai"
  }
}
        """.strip()
        )

        print(Formatter.info("\n提示: 修改配置文件后，使用 'setup reload' 立即生效，或重启 CLI。"))

        return CommandResult.ok("配置信息显示完成")
