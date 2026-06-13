# backend/app/cli/shell/commands/provider.py
"""
@fileoverview CLI Provider 命令模块（交互式 AI Provider 管理器）

功能概述:
- 提供交互式 AI Provider 管理界面，与前端 AI 设置面板对齐
- 支持添加、编辑、删除、测试 Provider
- 支持设置默认 Provider
- 支持查看配置文件路径和模板
- 支持热重载配置文件

架构设计:
- ProviderCommand 继承 Command 基类
- execute() 进入交互式主循环
- 通过 config_storage 管理配置，通过 provider registry 测试连接
- 预设从 presets.py 加载

输入示例:
    precis> provider
    precis> provider reload
    precis> provider test openai

输出示例:
    交互式菜单或操作结果
"""

import asyncio
import getpass

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.config_storage import (
    get_cli_config,
    reload_providers_config,
)
from app.cli.shell.formatter import Colors, Formatter
from app.cli.shell.interactive_menu import InteractiveMenu
from app.shared.services.llm.config.loader import loader
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.config.presets import get_preset_list
from app.shared.services.llm.providers.registry import create


class ProviderCommand(Command):
    """交互式 AI Provider 管理器。

    提供与前端 AI 设置面板对齐的 CLI 管理界面：
    - 查看已配置 Provider 列表（含状态、默认标记）
    - 添加新 Provider（选预设 → 填 API Key → 选模型 → 命名）
    - 编辑已有 Provider（名称、API Key、模型）
    - 删除 Provider（带确认）
    - 测试 Provider 连接
    - 设置默认 Provider
    - 查看配置文件路径和模板
    """

    def __init__(self):
        super().__init__("provider")
        self._config = get_cli_config()

    @property
    def description(self) -> str:
        return "AI Provider 管理"

    @property
    def usage(self) -> str:
        return "provider [reload|test <id>]"

    @property
    def help_text(self) -> str:
        return """
用法: provider [子命令] [参数]

子命令:
  provider              进入交互式 Provider 管理界面
  provider reload       热重载 ai_providers.yaml 配置
  provider test <id>    测试指定 Provider 的连接

说明:
  交互式界面支持以下操作：
  - 添加新 Provider（从预设选择）
  - 编辑已有 Provider
  - 删除 Provider
  - 测试 Provider 连接
  - 设置默认 Provider
  - 查看配置文件路径和模板
        """.strip()

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行 provider 命令。

        Args:
            args: 命令参数列表
            context: 命令上下文

        Returns:
            操作结果
        """
        if not args:
            return self._interactive_main_loop()

        sub = args[0].lower()
        if sub == "reload":
            return self._reload_providers_config()
        elif sub == "test" and len(args) > 1:
            return self._test_provider(args[1])
        else:
            return self._interactive_main_loop()

    # ── 主循环 ──────────────────────────────────────────────────────

    def _interactive_main_loop(self) -> CommandResult:
        """交互式主循环。"""
        while True:
            self._render_main_menu()
            menu = InteractiveMenu("请选择操作:", show_cancel=True)
            menu.add_item("add", "添加 Provider", "从预设添加新的 Provider")
            menu.add_item("edit", "编辑 Provider", "修改已有 Provider 配置")
            menu.add_item("delete", "删除 Provider", "删除已有 Provider")
            menu.add_item("test", "测试连接", "测试 Provider 的连接状态")
            menu.add_item("default", "设为默认", "设置默认使用的 Provider")
            menu.add_item("advanced", "高级", "查看配置文件路径和模板")

            choice = menu.show()
            if choice is None:
                return CommandResult.ok("已退出")
            elif choice == "add":
                self._add_provider()
            elif choice == "edit":
                self._edit_provider()
            elif choice == "delete":
                self._delete_provider()
            elif choice == "test":
                self._test_all_providers()
            elif choice == "default":
                self._set_default_provider()
            elif choice == "advanced":
                self._show_advanced()

    def _render_main_menu(self) -> None:
        """渲染主菜单头部信息。"""
        print(Formatter.header("\nAI Provider 管理"))
        print(Formatter.info(f"配置文件: {loader.config_path}"))

        providers = self._config.list_providers()
        active = self._config.get_active_provider()

        if not providers:
            print(Formatter.warning("\n[!] 当前未配置任何 Provider"))
        else:
            print()
            for p in providers:
                is_active = active and active.id == p.id
                marker = Formatter.colorize(" [默认]", Colors.GREEN) if is_active else ""
                provider_type = p.type.value if hasattr(p.type, "value") else str(p.type)
                key_status = Formatter.success("[已配置]") if p.api_key else Formatter.warning("[未配置]")
                print(f"  {Formatter.colorize(p.name, Colors.BOLD)} ({p.id}) {key_status}{marker}")
                print(f"    {provider_type} | {p.model} | {p.base_url}")
            print()

    # ── 添加 Provider ───────────────────────────────────────────────

    def _add_provider(self) -> None:
        """添加新 Provider（选预设 → 模型 → 命名 → 输入 API Key）。"""
        presets = get_preset_list()
        if not presets:
            print(Formatter.warning("\n[!] 没有可用的预设"))
            return

        print(Formatter.header("\n添加 Provider"))

        # 选择预设
        menu = InteractiveMenu("请选择服务商预设:")
        for pr in presets:
            menu.add_item(pr["id"], pr["name"], f"{pr['type']} | {pr['base_url']}")

        preset_id = menu.show()
        if preset_id is None:
            print(Formatter.info("已取消"))
            return

        preset = next((p for p in presets if p["id"] == preset_id), None)
        if not preset:
            print(Formatter.error("预设不存在"))
            return

        # 选择模型
        model = preset["default_model"]
        if preset["models"]:
            model_menu = InteractiveMenu("请选择模型:")
            for m in preset["models"]:
                model_menu.add_item(m, m, "")
            chosen = model_menu.show()
            if chosen:
                model = chosen
            elif chosen is None:
                print(Formatter.info("已取消"))
                return
        else:
            try:
                custom = input(Formatter.colorize(f"\n请输入模型名称 (默认: {model}): ", Colors.CYAN)).strip()
                if custom:
                    model = custom
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info("已取消"))
                return

        # 命名
        name = preset["name"]
        try:
            custom_name = input(Formatter.colorize(f"\nProvider 名称 (默认: {name}): ", Colors.CYAN)).strip()
            if custom_name:
                name = custom_name
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info("已取消"))
            return

        # 输入 API Key（本地 Ollama 可直接回车跳过）
        api_key = None
        if preset["type"] != "ollama":
            try:
                key_input = getpass.getpass(
                    Formatter.colorize("\n请输入 API Key (直接回车可跳过，后续通过环境变量设置): ", Colors.CYAN)
                ).strip()
                if key_input:
                    api_key = key_input
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info("已取消"))
                return

        # 生成 ID
        provider_id = preset["id"]
        existing_ids = {p.id for p in self._config.list_providers()}
        if provider_id in existing_ids:
            suffix = 2
            while f"{provider_id}-{suffix}" in existing_ids:
                suffix += 1
            provider_id = f"{provider_id}-{suffix}"

        provider = AIProvider(
            id=provider_id,
            name=name,
            type=ProviderType.OPENAI if preset["type"] == "openai" else ProviderType.OLLAMA,
            base_url=preset["base_url"],
            model=model,
            api_key=api_key,
        )
        self._config.add_or_update_provider(provider)

        print(Formatter.success(f"\n[*] 已添加 Provider: {name} ({provider_id})"))
        print(Formatter.info(f"  模型: {model}"))
        if preset["type"] != "ollama":
            if api_key:
                print(Formatter.info("  API Key: 已保存"))
            else:
                print(Formatter.warning("  API Key: 未配置，可通过环境变量或编辑 Provider 设置"))

    # ── 编辑 Provider ───────────────────────────────────────────────

    def _edit_provider(self) -> None:
        """编辑已有 Provider。"""
        providers = self._config.list_providers()
        if not providers:
            print(Formatter.warning("\n[!] 没有可编辑的 Provider"))
            return

        print(Formatter.header("\n编辑 Provider"))

        menu = InteractiveMenu("请选择要编辑的 Provider:")
        for p in providers:
            key_status = "[已配置]" if p.api_key else "[未配置]"
            menu.add_item(p.id, f"{p.name} ({p.id}) {key_status}", f"{p.model}")

        provider_id = menu.show()
        if provider_id is None:
            print(Formatter.info("已取消"))
            return

        provider = self._config.get_provider(provider_id)
        if not provider:
            print(Formatter.error("Provider 不存在"))
            return

        # 编辑菜单
        while True:
            # 统一使用 AIProvider 的 type 字段
            provider_type = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
            print(f"\n  编辑: {Formatter.colorize(provider.name, Colors.BOLD)} ({provider.id})")
            print(f"  类型: {provider_type} | 模型: {provider.model}")
            print(f"  端点: {provider.base_url}")
            print(f"  API Key: {'[已配置]' if provider.api_key else '[未配置]'}")

            edit_menu = InteractiveMenu("请选择要修改的字段:")
            edit_menu.add_item("name", "名称", f"当前: {provider.name}")
            edit_menu.add_item("model", "模型", f"当前: {provider.model}")
            edit_menu.add_item("api_key", "API Key", f"当前: {'[已配置]' if provider.api_key else '[未配置]'}")
            edit_menu.add_item("done", "完成并保存", "")

            field = edit_menu.show()
            if field is None or field == "done":
                break

            try:
                if field == "name":
                    val = input(Formatter.colorize(f"  新名称 (当前: {provider.name}): ", Colors.CYAN)).strip()
                    if val:
                        provider.name = val
                elif field == "model":
                    val = input(Formatter.colorize(f"  新模型 (当前: {provider.model}): ", Colors.CYAN)).strip()
                    if val:
                        provider.model = val
                elif field == "api_key":
                    key_input = getpass.getpass(
                        Formatter.colorize(
                            f"  新 API Key (当前: {'已配置' if provider.api_key else '未配置'}, 直接回车保持不变): ",
                            Colors.CYAN,
                        )
                    ).strip()
                    if key_input:
                        provider.api_key = key_input
                    elif provider.api_key:
                        # 询问是否清空
                        confirm = (
                            input(Formatter.colorize("  是否清空已保存的 API Key? (y/N): ", Colors.YELLOW))
                            .strip()
                            .lower()
                        )
                        if confirm in ("y", "yes"):
                            provider.api_key = None
            except (KeyboardInterrupt, EOFError):
                print()
                break

        self._config.add_or_update_provider(provider)
        print(Formatter.success(f"\n[*] 已更新: {provider.name}"))

    # ── 删除 Provider ───────────────────────────────────────────────

    def _delete_provider(self) -> None:
        """删除 Provider。"""
        providers = self._config.list_providers()
        if not providers:
            print(Formatter.warning("\n[!] 没有可删除的 Provider"))
            return

        print(Formatter.header("\n删除 Provider"))

        menu = InteractiveMenu("请选择要删除的 Provider:")
        for p in providers:
            menu.add_item(p.id, f"{p.name} ({p.id})", f"{p.model}")

        provider_id = menu.show()
        if provider_id is None:
            print(Formatter.info("已取消"))
            return

        provider = self._config.get_provider(provider_id)
        if not provider:
            print(Formatter.error("Provider 不存在"))
            return

        print(Formatter.warning(f"\n警告: 将删除 {provider.name} ({provider.id})"))
        try:
            confirm = input(Formatter.colorize("确认删除? (y/N): ", Colors.YELLOW)).strip().lower()
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info("已取消"))
            return

        if confirm not in ("y", "yes"):
            print(Formatter.info("已取消"))
            return

        if self._config.delete_provider(provider_id):
            print(Formatter.success(f"\n[*] 已删除: {provider.name}"))
        else:
            print(Formatter.error("删除失败"))

    # ── 测试连接 ────────────────────────────────────────────────────

    def _test_all_providers(self) -> None:
        """测试所有 Provider 的连接。"""
        providers = self._config.list_providers()
        if not providers:
            print(Formatter.warning("\n[!] 没有可测试的 Provider"))
            return

        print(Formatter.header("\n测试 Provider 连接"))

        for p in providers:
            self._test_single(p)
            print()

    def _test_single(self, provider: AIProvider) -> None:
        """测试单个 Provider 的连接。"""
        print(f"  测试 {Formatter.colorize(provider.name, Colors.BOLD)} ({provider.id})...", end=" ")
        try:
            prov = create(provider)
            result = asyncio.run(prov.health())

            status = result.get("status", "error")
            if status == "ok":
                latency = result.get("latency_ms", result.get("response_time_ms", "?"))
                print(Formatter.success(f"✓ 正常 ({latency}ms)"))
            else:
                error = result.get("error", "未知错误")
                print(Formatter.error(f"✗ {error}"))
        except Exception as e:
            print(Formatter.error(f"✗ {e}"))

    def _test_provider(self, provider_id: str) -> CommandResult:
        """测试指定 Provider 的连接（非交互式）。"""
        provider = self._config.get_provider(provider_id)
        if not provider:
            return CommandResult.error(f"Provider '{provider_id}' 未配置")

        self._test_single(provider)
        return CommandResult.ok("测试完成")

    # ── 设置默认 ────────────────────────────────────────────────────

    def _set_default_provider(self) -> None:
        """设置默认 Provider。"""
        providers = self._config.list_providers()

        if not providers:
            print(Formatter.warning("\n[!] 没有已配置的 Provider"))
            print(Formatter.info("请先使用 '添加 Provider' 添加 Provider"))
            return

        print(Formatter.header("\n设置默认 Provider"))

        active = self._config.get_active_provider()
        menu = InteractiveMenu("请选择默认 Provider:")
        for p in providers:
            is_active = active and active.id == p.id
            marker = " [当前]" if is_active else ""
            menu.add_item(p.id, f"{p.name} ({p.id}){marker}", f"{p.model}")

        provider_id = menu.show()
        if provider_id is None:
            print(Formatter.info("已取消"))
            return

        if self._config.set_active_provider(provider_id):
            provider = self._config.get_provider(provider_id)
            print(Formatter.success(f"\n[*] 已设置默认 Provider: {provider.name}"))
        else:
            print(Formatter.error("设置失败"))

    # ── 高级 ────────────────────────────────────────────────────────

    def _show_advanced(self) -> None:
        """显示高级信息（配置文件路径、模板）。"""
        print(Formatter.header("\n高级设置"))

        config_path = loader.config_path
        print("\n  配置文件路径:")
        print(f"  {Formatter.info(str(config_path))}")

        print("\n  配置模板:")
        template = self._get_config_template()
        for line in template.split("\n"):
            print(f"  {Formatter.dim(line)}")

        tip = '提示: 修改配置文件后，使用 "provider reload" 立即生效'
        print(f"\n  {Formatter.dim(tip)}")

    def _get_config_template(self) -> str:
        """获取配置模板文本。"""
        return """version: "2.0"

providers:
  # OpenAI 或兼容 API
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: sk-xxx
    model: gpt-4o

  # DeepSeek
  - id: deepseek
    name: DeepSeek
    type: openai
    base_url: https://api.deepseek.com
    api_key: sk-xxx
    model: deepseek-v4-flash

  # 本地 Ollama（无需 API Key）
  - id: ollama-local
    name: Ollama Local
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

defaults:
  chat: openai

# 也支持通过环境变量设置 API Key（优先级高于配置文件）:
# export OPENAI_API_KEY=sk-xxx
# export DEEPSEEK_API_KEY=sk-xxx""".strip()

    # ── 重载 ────────────────────────────────────────────────────────

    def _reload_providers_config(self) -> CommandResult:
        """热重载 Provider 配置文件。"""
        print(Formatter.header("\n热重载 Provider 配置"))
        print(Formatter.info(f"配置文件: {loader.config_path}"))

        if reload_providers_config():
            providers = self._config.list_providers()
            if providers:
                print(Formatter.success("\n[*] 配置重载成功！"))
                print(Formatter.info(f"  已配置 {len(providers)} 个 Provider:"))
                for p in providers:
                    print(f"    - {p.id}: {p.name} ({p.model})")
            else:
                print(Formatter.warning("\n[!] 配置文件为空，请先添加 Provider"))
            return CommandResult.ok("配置已更新")
        else:
            return CommandResult.error(
                "配置重载失败，请检查文件格式是否正确。\n提示: 配置文件必须是有效的 YAML 格式，包含 'providers' 字段。"
            )


__all__ = ["ProviderCommand"]
