# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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

from app.cli.i18n import tr
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
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
    - 添加新 Provider（从预设或自定义 OpenAI 兼容端点添加）
    - 编辑已有 Provider（名称、API Key、模型）
    - 删除 Provider（带确认）
    - 测试 Provider 连接
    - 设置默认 Provider
    - 查看配置文件路径和模板
    """

    def __init__(self) -> None:
        super().__init__("provider")
        self._config = get_cli_config()

    @property
    def description(self) -> str:
        return tr("AI Provider management", "AI Provider 管理")

    @property
    def usage(self) -> str:
        return "provider [reload|test <id>]"

    @property
    def help_text(self) -> str:
        return tr(
            """
Usage: provider [subcommand] [args]

Subcommands:
  provider              Enter the interactive Provider management UI
  provider reload       Hot-reload ai_providers.yaml
  provider test <id>    Test the connection of a specific provider

Notes:
  The interactive UI supports the following operations:
  - Add a new provider (from presets or a custom endpoint)
  - Edit an existing provider
  - Delete a provider
  - Test provider connections
  - Set the default provider
  - View config file path and template
            """,
            """
用法: provider [子命令] [参数]

子命令:
  provider              进入交互式 Provider 管理界面
  provider reload       热重载 ai_providers.yaml 配置
  provider test <id>    测试指定 Provider 的连接

说明:
  交互式界面支持以下操作：
  - 添加新 Provider（从预设或自定义端点添加）
  - 编辑已有 Provider
  - 删除 Provider
  - 测试 Provider 连接
  - 设置默认 Provider
  - 查看配置文件路径和模板
            """,
        ).strip()

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行 provider 命令。

        Args:
            args: 命令参数列表
            context: 项目上下文

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
            menu = InteractiveMenu(tr("Select an operation:", "请选择操作:"), show_cancel=True)
            menu.add_item(
                "add",
                tr("Add provider", "添加 Provider"),
                tr("Add from a preset or custom endpoint", "从预设或自定义端点添加"),
            )
            menu.add_item(
                "edit",
                tr("Edit provider", "编辑 Provider"),
                tr("Modify an existing provider", "修改已有 Provider 配置"),
            )
            menu.add_item(
                "delete", tr("Delete provider", "删除 Provider"), tr("Delete an existing provider", "删除已有 Provider")
            )
            menu.add_item(
                "test",
                tr("Test connection", "测试连接"),
                tr("Test provider connection status", "测试 Provider 的连接状态"),
            )
            menu.add_item(
                "default", tr("Set default", "设为默认"), tr("Set the default provider", "设置默认使用的 Provider")
            )
            menu.add_item(
                "advanced", tr("Advanced", "高级"), tr("View config file path and template", "查看配置文件路径和模板")
            )

            choice = menu.show()
            if choice is None:
                return CommandResult.ok(tr("Exited", "已退出"))
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
        print(Formatter.header("\n" + tr("AI Provider management", "AI Provider 管理")))
        print(Formatter.info(tr("Config file: {path}", "配置文件: {path}").format(path=loader.config_path)))

        providers = self._config.list_providers()
        active = self._config.get_active_provider()

        if not providers:
            print(Formatter.warning("\n[!] " + tr("No providers configured yet", "当前未配置任何 Provider")))
        else:
            print()
            for p in providers:
                is_active = active and active.id == p.id
                marker = Formatter.colorize(" " + tr("[default]", "[默认]"), Colors.GREEN) if is_active else ""
                provider_type = p.type.value if hasattr(p.type, "value") else str(p.type)
                key_status = (
                    Formatter.success(tr("[configured]", "[已配置]"))
                    if p.api_key
                    else Formatter.warning(tr("[not configured]", "[未配置]"))
                )
                print(f"  {Formatter.colorize(p.name, Colors.BOLD)} ({p.id}) {key_status}{marker}")
                print(f"    {provider_type} | {p.model} | {p.base_url}")
            print()

    # ── 添加 Provider ───────────────────────────────────────────────

    def _add_provider(self) -> None:
        """添加新 Provider（选预设或自定义端点 → 模型 → 命名 → 输入 API Key）。"""
        presets = get_preset_list()
        if not presets:
            print(Formatter.warning("\n[!] " + tr("No presets available", "没有可用的预设")))
            return

        print(Formatter.header("\n" + tr("Add provider", "添加 Provider")))

        # 选择预设（末尾追加自定义 OpenAI 兼容端点入口）
        menu = InteractiveMenu(tr("Select a provider preset:", "请选择服务商预设:"))
        for pr in presets:
            menu.add_item(pr["id"], pr["name"], f"{pr['type']} | {pr['base_url']}")
        menu.add_item(
            "custom",
            "Custom (OpenAI-compatible)",
            tr("Custom endpoint: any OpenAI-compatible API", "自定义端点：任意 OpenAI 兼容 API"),
        )

        preset_id = menu.show()
        if preset_id is None:
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        # 自定义端点分支：名称/base_url/模型/API Key/上下文窗口全部交互收集
        if preset_id == "custom":
            collected = self._collect_custom_inputs()
            if collected is None:
                return
            name, base_url, model, api_key, context_window = collected
            self._finish_add_provider(
                base_id=name.lower().replace(" ", "-"),
                name=name,
                provider_type=ProviderType.OPENAI,
                base_url=base_url,
                model=model,
                api_key=api_key,
                context_window=context_window,
            )
            return

        preset = next((p for p in presets if p["id"] == preset_id), None)
        if not preset:
            print(Formatter.error(tr("Preset not found", "预设不存在")))
            return

        # 选择模型
        model = preset["default_model"]
        if preset["models"]:
            model_menu = InteractiveMenu(tr("Select a model:", "请选择模型:"))
            for m in preset["models"]:
                model_menu.add_item(m, m, "")
            chosen = model_menu.show()
            if chosen:
                model = chosen
            elif chosen is None:
                print(Formatter.info(tr("Cancelled", "已取消")))
                return
        else:
            try:
                custom = input(
                    Formatter.colorize(
                        tr("\nEnter model name (default: {model}): ", "\n请输入模型名称 (默认: {model}): ").format(
                            model=model
                        ),
                        Colors.CYAN,
                    )
                ).strip()
                if custom:
                    model = custom
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info(tr("Cancelled", "已取消")))
                return

        # 命名
        name = preset["name"]
        try:
            custom_name = input(
                Formatter.colorize(
                    tr("\nProvider name (default: {name}): ", "\nProvider 名称 (默认: {name}): ").format(name=name),
                    Colors.CYAN,
                )
            ).strip()
            if custom_name:
                name = custom_name
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        # 输入 API Key（本地 Ollama 可直接回车跳过）
        api_key = None
        if preset["type"] != "ollama":
            try:
                key_input = getpass.getpass(
                    Formatter.colorize(
                        tr(
                            "\nEnter API Key (press Enter to skip; set later via environment variable): ",
                            "\n请输入 API Key (直接回车可跳过，后续通过环境变量设置): ",
                        ),
                        Colors.CYAN,
                    )
                ).strip()
                if key_input:
                    api_key = key_input
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info(tr("Cancelled", "已取消")))
                return

        # 上下文窗口（可选，留空=自动探测）
        context_window = None
        try:
            context_window, _ = self._prompt_context_window()
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        self._finish_add_provider(
            base_id=preset["id"],
            name=name,
            provider_type=ProviderType.OPENAI if preset["type"] == "openai" else ProviderType.OLLAMA,
            base_url=preset["base_url"],
            model=model,
            api_key=api_key,
            context_window=context_window,
        )

    def _collect_custom_inputs(self) -> tuple[str, str, str, str | None, int | None] | None:
        """收集自定义 OpenAI 兼容端点的交互输入。

        Returns:
            (名称, base_url, 模型, API Key, 上下文窗口)；用户中断或必填项为空返回 None。
        """
        print(
            Formatter.header("\n" + tr("Add custom provider (OpenAI-compatible)", "添加自定义 Provider（OpenAI 兼容）"))
        )

        # 名称（必填，空则取消）
        try:
            name = input(Formatter.colorize(tr("\nProvider name: ", "\nProvider 名称: "), Colors.CYAN)).strip()
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return None
        if not name:
            print(Formatter.warning("[!] " + tr("Name cannot be empty, cancelled", "名称不能为空，已取消")))
            return None

        # base_url（必填，必须以 http:// 或 https:// 开头，否则警告并重新询问；空则取消）
        while True:
            try:
                base_url = input(
                    Formatter.colorize(
                        tr(
                            "\nEnter base_url (e.g. https://api.example.com/v1): ",
                            "\n请输入 base_url (如 https://api.example.com/v1): ",
                        ),
                        Colors.CYAN,
                    )
                ).strip()
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info(tr("Cancelled", "已取消")))
                return None
            if not base_url:
                print(
                    Formatter.warning("[!] " + tr("base_url cannot be empty, cancelled", "base_url 不能为空，已取消"))
                )
                return None
            if base_url.startswith(("http://", "https://")):
                break
            print(
                Formatter.warning(
                    "[!] "
                    + tr(
                        "base_url must start with http:// or https://, try again",
                        "base_url 必须以 http:// 或 https:// 开头，请重新输入",
                    )
                )
            )

        # 输入 API Key（可回车跳过）
        api_key = None
        try:
            key_input = getpass.getpass(
                Formatter.colorize(
                    tr(
                        "\nEnter API Key (press Enter to skip; set later via environment variable): ",
                        "\n请输入 API Key (直接回车可跳过，后续通过环境变量设置): ",
                    ),
                    Colors.CYAN,
                )
            ).strip()
            if key_input:
                api_key = key_input
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return None

        # 模型名称：优先尝试从端点拉取（拉取依赖 base_url 与 API Key，故置于两者之后）
        model: str | None = None
        try:
            confirm = (
                input(
                    Formatter.colorize(
                        tr("\nFetch model list from the endpoint? (y/N): ", "\n是否从端点拉取模型列表? (y/N): "),
                        Colors.CYAN,
                    )
                )
                .strip()
                .lower()
            )
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return None
        if confirm in ("y", "yes"):
            try:
                model = self._fetch_and_pick_model(base_url, api_key)
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info(tr("Cancelled", "已取消")))
                return None
            # model 为 None 表示拉取失败或用户空输入 → 回退到下面的手动模型输入环节

        # 模型名称（必填，拉取未选时手动输入；空则取消）
        if model is None:
            try:
                model = input(Formatter.colorize(tr("\nEnter model name: ", "\n请输入模型名称: "), Colors.CYAN)).strip()
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info(tr("Cancelled", "已取消")))
                return None
            if not model:
                print(
                    Formatter.warning("[!] " + tr("Model name cannot be empty, cancelled", "模型名称不能为空，已取消"))
                )
                return None

        # 上下文窗口（可选，留空=自动探测）
        try:
            context_window, _ = self._prompt_context_window()
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return None

        return name, base_url, model, api_key, context_window

    def _fetch_and_pick_model(self, base_url: str, api_key: str | None) -> str | None:
        """从端点拉取模型列表并让用户选择（构造临时 Provider，不落盘）。

        Returns:
            选中的模型名；拉取失败、端点返回空列表或用户空输入返回 None（回退手动输入）。
        """
        temp = AIProvider(
            id="_fetch_models",
            name="fetch-models",
            type=ProviderType.OPENAI,
            base_url=base_url,
            api_key=api_key,
            model="",
        )
        try:
            models = asyncio.run(create(temp).list_models())
        except Exception as e:
            # 拉取失败：打印警告但不阻断，继续走手动输入
            print(
                Formatter.warning(
                    tr(
                        "\n[!] Failed to fetch model list: {error}, enter the model name manually",
                        "\n[!] 拉取模型列表失败: {error}，请手动输入模型名称",
                    ).format(error=e)
                )
            )
            return None
        if not models:
            print(
                Formatter.warning(
                    tr(
                        "\n[!] Endpoint returned no models, enter the model name manually",
                        "\n[!] 端点未返回任何模型，请手动输入模型名称",
                    )
                )
            )
            return None

        print(
            Formatter.success(
                tr("\n[*] Fetched {count} models:", "\n[*] 已拉取 {count} 个模型:").format(count=len(models))
            )
        )
        for i, m in enumerate(models, start=1):
            print(f"    {i}. {m}")
        choice = input(
            Formatter.colorize(
                tr(
                    "Enter a number to pick a model, or type the model name directly: ",
                    "输入编号选择模型，或直接输入模型名称: ",
                ),
                Colors.CYAN,
            )
        ).strip()
        if not choice:
            return None
        # 编号合法则取对应模型，否则把输入当模型名
        if choice.isdigit() and 1 <= int(choice) <= len(models):
            return models[int(choice) - 1]
        return choice

    def _finish_add_provider(
        self,
        base_id: str,
        name: str,
        provider_type: ProviderType,
        base_url: str,
        model: str,
        api_key: str | None,
        context_window: int | None,
    ) -> None:
        """生成 ID、构造并保存新 Provider，打印确认信息（预设与自定义分支共用收尾）。

        Args:
            base_id: Provider ID 基础值（预设用预设 id，自定义用名称派生），冲突时追加 -2/-3 后缀
            name: 显示名称
            provider_type: Provider 类型
            base_url: API 端点
            model: 模型名称
            api_key: API Key（None 表示未配置）
            context_window: 上下文窗口（None 表示自动探测）
        """
        # 生成 ID
        provider_id = base_id
        existing_ids = {p.id for p in self._config.list_providers()}
        if provider_id in existing_ids:
            suffix = 2
            while f"{provider_id}-{suffix}" in existing_ids:
                suffix += 1
            provider_id = f"{provider_id}-{suffix}"

        provider = AIProvider(
            id=provider_id,
            name=name,
            type=provider_type,
            base_url=base_url,
            model=model,
            api_key=api_key,
            context_window=context_window,
        )
        # §2.12 修复：用户显式输入的 key 标记为手工来源——否则该 id 若存在同名
        # <ID>_API_KEY 环境变量，save 会把刚输入的 key 当 env 来源剔除、永不落盘
        if api_key:
            self._config.mark_api_key_manual(provider_id)
        self._config.add_or_update_provider(provider)

        print(
            Formatter.success(
                tr("\n[*] Provider added: {name} ({id})", "\n[*] 已添加 Provider: {name} ({id})").format(
                    name=name, id=provider_id
                )
            )
        )
        print(Formatter.info(tr("  Model: {model}", "  模型: {model}").format(model=model)))
        cw_display = (
            str(context_window) if context_window else tr("auto-detect (default 200000)", "自动探测（默认 200000）")
        )
        print(Formatter.info(tr("  Context window: {cw}", "  上下文窗口: {cw}").format(cw=cw_display)))
        if provider_type != ProviderType.OLLAMA:
            if api_key:
                print(Formatter.info(tr("  API Key: saved", "  API Key: 已保存")))
            else:
                print(
                    Formatter.warning(
                        tr(
                            "  API Key: not set; configure via environment variable or by editing the provider",
                            "  API Key: 未配置，可通过环境变量或编辑 Provider 设置",
                        )
                    )
                )

    # ── 编辑 Provider ───────────────────────────────────────────────

    def _prompt_context_window(self, current: int | None = None) -> tuple[int | None, bool]:
        """交互式输入 context_window。

        Args:
            current: 当前已配置的值（编辑场景传入，添加场景为 None）

        Returns:
            (值, 是否合法输入)：
            - 留空（直接回车）返回 (None, True)，表示自动探测/回退到全局默认 200000；
            - 非法输入（非整数或 < 1024）返回 (None, False)，表示"已忽略"，
              调用方应保留原值（编辑场景）；
            - 合法整数返回 (value, True)。
            用户中断（Ctrl+C / EOF）抛 KeyboardInterrupt/EOFError 由调用方处理。
        """
        prompt_current = str(current) if current else tr("auto-detect (default 200000)", "自动探测（默认 200000）")
        raw = input(
            Formatter.colorize(
                tr(
                    "  Context window tokens (current: {current}, empty=auto): ",
                    "  上下文窗口 tokens (当前: {current}, 留空=自动): ",
                ).format(current=prompt_current),
                Colors.CYAN,
            )
        ).strip()
        if not raw:
            return None, True
        try:
            value = int(raw)
        except ValueError:
            print(Formatter.warning("  [!] " + tr("Not an integer, ignored", "非整数，已忽略")))
            return None, False
        if value < 1024:
            print(Formatter.warning("  [!] " + tr("Must be >= 1024, ignored", "必须 >= 1024，已忽略")))
            return None, False
        return value, True

    def _edit_provider(self) -> None:
        """编辑已有 Provider。"""
        providers = self._config.list_providers()
        if not providers:
            print(Formatter.warning("\n[!] " + tr("No providers to edit", "没有可编辑的 Provider")))
            return

        print(Formatter.header("\n" + tr("Edit provider", "编辑 Provider")))

        menu = InteractiveMenu(tr("Select a provider to edit:", "请选择要编辑的 Provider:"))
        for p in providers:
            key_status = tr("[configured]", "[已配置]") if p.api_key else tr("[not configured]", "[未配置]")
            menu.add_item(p.id, f"{p.name} ({p.id}) {key_status}", f"{p.model}")

        provider_id = menu.show()
        if provider_id is None:
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        provider = self._config.get_provider(provider_id)
        if not provider:
            print(Formatter.error(tr("Provider not found", "Provider 不存在")))
            return

        # 编辑副本：后续字段修改只作用于副本，仅显式 "done" 才落盘；
        # ESC/中断丢弃副本，存储内与磁盘上的配置均不被污染
        provider = provider.model_copy(deep=True)
        # §2.12 修复：仅在用户显式输入新 key 时标记手工来源（提交前统一标记，
        # ESC 丢弃编辑则不标记——否则后续任何无关 save 会把 env 注入值当手工值落盘）
        key_manually_set = False

        # 编辑菜单
        while True:
            # 统一使用 AIProvider 的 type 字段
            provider_type = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
            cw_display = (
                str(provider.context_window)
                if provider.context_window
                else tr("auto-detect (default 200000)", "自动探测（默认 200000）")
            )
            print(f"\n  {tr('Editing:', '编辑:')} {Formatter.colorize(provider.name, Colors.BOLD)} ({provider.id})")
            print(f"  {tr('Type:', '类型:')} {provider_type} | {tr('Model:', '模型:')} {provider.model}")
            print(f"  {tr('Endpoint:', '端点:')} {provider.base_url}")
            print(f"  {tr('Context window:', '上下文窗口:')} {cw_display}")
            print(
                f"  API Key: {tr('[configured]', '[已配置]') if provider.api_key else tr('[not configured]', '[未配置]')}"
            )

            edit_menu = InteractiveMenu(tr("Select a field to modify:", "请选择要修改的字段:"))
            edit_menu.add_item("name", tr("Name", "名称"), tr("Current: {v}", "当前: {v}").format(v=provider.name))
            edit_menu.add_item("model", tr("Model", "模型"), tr("Current: {v}", "当前: {v}").format(v=provider.model))
            edit_menu.add_item(
                "context_window",
                tr("Context window", "上下文窗口"),
                tr("Current: {v}", "当前: {v}").format(v=cw_display),
            )
            edit_menu.add_item(
                "api_key",
                "API Key",
                tr("Current: {v}", "当前: {v}").format(
                    v=tr("[configured]", "[已配置]") if provider.api_key else tr("[not configured]", "[未配置]")
                ),
            )
            edit_menu.add_item("done", tr("Finish and save", "完成并保存"), "")

            field = edit_menu.show()
            if field is None:
                # ESC/0 取消：丢弃编辑副本，不写盘
                print(Formatter.info(tr("Cancelled", "已取消")))
                return
            if field == "done":
                break

            try:
                if field == "name":
                    val = input(
                        Formatter.colorize(
                            tr("  New name (current: {v}): ", "  新名称 (当前: {v}): ").format(v=provider.name),
                            Colors.CYAN,
                        )
                    ).strip()
                    if val:
                        provider.name = val
                elif field == "model":
                    val = input(
                        Formatter.colorize(
                            tr("  New model (current: {v}): ", "  新模型 (当前: {v}): ").format(v=provider.model),
                            Colors.CYAN,
                        )
                    ).strip()
                    if val:
                        provider.model = val
                elif field == "context_window":
                    # 留空→None（自动探测）；非法输入忽略并保留原值；合法整数直接写入
                    cw, valid = self._prompt_context_window(provider.context_window)
                    if valid:
                        provider.context_window = cw
                elif field == "api_key":
                    key_input = getpass.getpass(
                        Formatter.colorize(
                            tr(
                                "  New API Key (current: {v}, press Enter to keep unchanged): ",
                                "  新 API Key (当前: {v}, 直接回车保持不变): ",
                            ).format(
                                v=tr("configured", "已配置") if provider.api_key else tr("not configured", "未配置")
                            ),
                            Colors.CYAN,
                        )
                    ).strip()
                    if key_input:
                        provider.api_key = key_input
                        key_manually_set = True
                    elif provider.api_key:
                        # 询问是否清空
                        confirm = (
                            input(
                                Formatter.colorize(
                                    tr("  Clear the saved API Key? (y/N): ", "  是否清空已保存的 API Key? (y/N): "),
                                    Colors.YELLOW,
                                )
                            )
                            .strip()
                            .lower()
                        )
                        if confirm in ("y", "yes"):
                            provider.api_key = None
            except (KeyboardInterrupt, EOFError):
                print()
                print(Formatter.info(tr("Cancelled", "已取消")))
                return

        # §2.12 修复：用户显式输入的新 key 标记为手工来源后再落盘——否则该 id
        # 若存在同名 <ID>_API_KEY 环境变量，save 会把新 key 当 env 来源剔除不落盘
        if key_manually_set:
            self._config.mark_api_key_manual(provider.id)
        self._config.add_or_update_provider(provider)
        print(Formatter.success(tr("\n[*] Updated: {name}", "\n[*] 已更新: {name}").format(name=provider.name)))

    # ── 删除 Provider ───────────────────────────────────────────────

    def _delete_provider(self) -> None:
        """删除 Provider。"""
        providers = self._config.list_providers()
        if not providers:
            print(Formatter.warning("\n[!] " + tr("No providers to delete", "没有可删除的 Provider")))
            return

        print(Formatter.header("\n" + tr("Delete provider", "删除 Provider")))

        menu = InteractiveMenu(tr("Select a provider to delete:", "请选择要删除的 Provider:"))
        for p in providers:
            menu.add_item(p.id, f"{p.name} ({p.id})", f"{p.model}")

        provider_id = menu.show()
        if provider_id is None:
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        provider = self._config.get_provider(provider_id)
        if not provider:
            print(Formatter.error(tr("Provider not found", "Provider 不存在")))
            return

        print(
            Formatter.warning(
                tr("\nWarning: {name} ({id}) will be deleted", "\n警告: 将删除 {name} ({id})").format(
                    name=provider.name, id=provider.id
                )
            )
        )
        try:
            confirm = (
                input(Formatter.colorize(tr("Confirm delete? (y/N): ", "确认删除? (y/N): "), Colors.YELLOW))
                .strip()
                .lower()
            )
        except (KeyboardInterrupt, EOFError):
            print()
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        if confirm not in ("y", "yes"):
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        if self._config.delete_provider(provider_id):
            print(Formatter.success(tr("\n[*] Deleted: {name}", "\n[*] 已删除: {name}").format(name=provider.name)))
        else:
            print(Formatter.error(tr("Delete failed", "删除失败")))

    # ── 测试连接 ────────────────────────────────────────────────────

    def _test_all_providers(self) -> None:
        """测试所有 Provider 的连接。"""
        providers = self._config.list_providers()
        if not providers:
            print(Formatter.warning("\n[!] " + tr("No providers to test", "没有可测试的 Provider")))
            return

        print(Formatter.header("\n" + tr("Test provider connections", "测试 Provider 连接")))

        for p in providers:
            self._test_single(p)
            print()

    def _test_single(self, provider: AIProvider) -> None:
        """测试单个 Provider 的连接。"""
        print(
            f"  {tr('Testing', '测试')} {Formatter.colorize(provider.name, Colors.BOLD)} ({provider.id})...",
            end=" ",
        )
        try:
            prov = create(provider)
            result = asyncio.run(prov.health())

            status = result.get("status", "error")
            if status == "ok":
                latency = result.get("latency_ms", result.get("response_time_ms", "?"))
                print(Formatter.success(tr("✓ OK ({latency}ms)", "✓ 正常 ({latency}ms)").format(latency=latency)))
            else:
                error = result.get("error", tr("unknown error", "未知错误"))
                print(Formatter.error(f"✗ {error}"))
        except Exception as e:
            print(Formatter.error(f"✗ {e}"))

    def _test_provider(self, provider_id: str) -> CommandResult:
        """测试指定 Provider 的连接（非交互式）。"""
        provider = self._config.get_provider(provider_id)
        if not provider:
            return CommandResult.error(
                tr("Provider '{id}' is not configured", "Provider '{id}' 未配置").format(id=provider_id)
            )

        self._test_single(provider)
        return CommandResult.ok(tr("Test completed", "测试完成"))

    # ── 设置默认 ────────────────────────────────────────────────────

    def _set_default_provider(self) -> None:
        """设置默认 Provider。"""
        providers = self._config.list_providers()

        if not providers:
            print(Formatter.warning("\n[!] " + tr("No providers configured", "没有已配置的 Provider")))
            print(
                Formatter.info(
                    tr(
                        "Add a provider first via 'Add provider'",
                        "请先使用 '添加 Provider' 添加 Provider",
                    )
                )
            )
            return

        print(Formatter.header("\n" + tr("Set default provider", "设置默认 Provider")))

        active = self._config.get_active_provider()
        menu = InteractiveMenu(tr("Select the default provider:", "请选择默认 Provider:"))
        for p in providers:
            is_active = active and active.id == p.id
            marker = " " + tr("[current]", "[当前]") if is_active else ""
            menu.add_item(p.id, f"{p.name} ({p.id}){marker}", f"{p.model}")

        provider_id = menu.show()
        if provider_id is None:
            print(Formatter.info(tr("Cancelled", "已取消")))
            return

        provider = self._config.get_provider(provider_id)
        if provider is not None and self._config.set_active_provider(provider_id):
            print(
                Formatter.success(
                    tr("\n[*] Default provider set: {name}", "\n[*] 已设置默认 Provider: {name}").format(
                        name=provider.name
                    )
                )
            )
        else:
            print(Formatter.error(tr("Failed to set", "设置失败")))

    # ── 高级 ────────────────────────────────────────────────────────

    def _show_advanced(self) -> None:
        """显示高级信息（配置文件路径、模板）。"""
        print(Formatter.header("\n" + tr("Advanced settings", "高级设置")))

        config_path = loader.config_path
        print("\n  " + tr("Config file path:", "配置文件路径:"))
        print(f"  {Formatter.info(str(config_path))}")

        print("\n  " + tr("Config template:", "配置模板:"))
        template = self._get_config_template()
        for line in template.split("\n"):
            print(f"  {Formatter.dim(line)}")

        tip = tr(
            'Tip: after editing the config file, run "provider reload" to apply it immediately',
            '提示: 修改配置文件后，使用 "provider reload" 立即生效',
        )
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
    model: deepseek-flash

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
        print(Formatter.header("\n" + tr("Hot-reload provider config", "热重载 Provider 配置")))
        print(Formatter.info(tr("Config file: {path}", "配置文件: {path}").format(path=loader.config_path)))

        if reload_providers_config():
            providers = self._config.list_providers()
            if providers:
                print(Formatter.success("\n[*] " + tr("Config reloaded successfully!", "配置重载成功！")))
                print(
                    Formatter.info(
                        tr("  {count} providers configured:", "  已配置 {count} 个 Provider:").format(
                            count=len(providers)
                        )
                    )
                )
                for p in providers:
                    print(f"    - {p.id}: {p.name} ({p.model})")
            else:
                print(
                    Formatter.warning(
                        "\n[!] " + tr("Config file is empty, add a provider first", "配置文件为空，请先添加 Provider")
                    )
                )
            return CommandResult.ok(tr("Config updated", "配置已更新"))
        else:
            return CommandResult.error(
                tr(
                    "Config reload failed, check the file format.\n"
                    "Tip: the config file must be valid YAML containing a 'providers' field.",
                    "配置重载失败，请检查文件格式是否正确。\n提示: 配置文件必须是有效的 YAML 格式，包含 'providers' 字段。",
                )
            )


__all__ = ["ProviderCommand"]
