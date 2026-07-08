"""TUI Provider 管理屏。

本屏提供 Provider 的增删改查 + 连接测试界面，对应 CLI 的 ``provider`` 命令。
布局：左侧 ListView（Provider 列表，含默认标记与 API Key 状态）+ 右侧详情面板；
添加/编辑用 ModalScreen 表单（Select 预设 + Input 模型/名称/Key/context_window）；
删除用确认 ModalScreen；测试连接为异步按钮，结果更新到列表项与详情。

业务逻辑委托 ``ProviderService``（后者复用 config_storage 与 registry），本屏只负责
交互与渲染。通过 ``@register_screen("provider")`` 注册到 SCREEN_REGISTRY。
"""

from __future__ import annotations

from typing import Any

from textual import on
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, Input, Label, ListItem, ListView, Select

from app.cli.tui.protocols import register_screen
from app.cli.tui.services.provider_service import ProviderService
from app.shared.services.llm.config.models import AIProvider


def _key_status(provider: AIProvider) -> str:
    """API Key 状态文案。"""
    return "已配置" if provider.api_key else "未配置"


def _provider_display(provider: AIProvider, active_id: str | None) -> str:
    """列表项显示文本：name/id + model + 默认标记 + Key 状态。"""
    marker = " [默认]" if active_id and provider.id == active_id else ""
    key = f"[Key: {_key_status(provider)}]"
    ptype = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
    return f"{provider.name} ({provider.id}){marker}\n  {ptype} | {provider.model} {key}"


def _provider_detail_text(provider: AIProvider, active_id: str | None) -> str:
    """右侧详情面板文本（使用 Rich markup 突出字段名）。"""
    ptype = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
    is_default = "[green]是[/green]" if active_id and provider.id == active_id else "否"
    cw = str(provider.context_window) if provider.context_window else "自动探测（默认 200000）"
    key_status = _key_status(provider)
    key_color = "green" if provider.api_key else "yellow"
    return (
        f"[bold]名称:[/bold] {provider.name}\n"
        f"[bold]ID:[/bold]   {provider.id}\n"
        f"[bold]类型:[/bold] {ptype}\n"
        f"[bold]模型:[/bold] {provider.model}\n"
        f"[bold]端点:[/bold] {provider.base_url}\n"
        f"[bold]上下文窗口:[/bold] {cw}\n"
        f"[bold]API Key:[/bold] [{key_color}]{key_status}[/{key_color}]\n"
        f"[bold]默认:[/bold] {is_default}"
    )


@register_screen("provider")
class ProviderScreen(Screen):
    """Provider 管理屏。

    左侧 ListView 展示所有 Provider，选中后在右侧详情面板显示完整信息；
    底部按钮提供 添加 / 编辑 / 删除 / 测试连接 / 设为默认 操作。
    """

    BINDINGS = [
        ("a", "add", "添加"),
        ("e", "edit", "编辑"),
        ("delete", "delete", "删除"),
        ("t", "test", "测试连接"),
        ("d", "set_default", "设为默认"),
        ("r", "refresh", "刷新"),
    ]
    DEFAULT_CSS = """
    ProviderScreen {
        layout: vertical;
        padding: 0 1;
    }
    #provider-main {
        height: 1fr;
        margin-bottom: 1;
    }
    #provider-list {
        width: 40%;
        border: round $accent;
        background: $surface;
        padding: 0 1;
        margin-right: 1;
    }
    #provider-list-title {
        text-style: bold;
        color: $accent;
        margin: 1 0;
    }
    #provider-detail {
        width: 60%;
        border: round $primary;
        background: $surface;
        padding: 1 2;
    }
    #provider-detail-label {
        color: $text;
    }
    #provider-actions {
        height: auto;
        dock: bottom;
        padding: 1;
    }
    #provider-actions Button {
        margin-right: 1;
    }
    #provider-status {
        height: 1;
        dock: bottom;
        background: $panel;
        color: $text-muted;
        padding: 0 1;
    }
    """

    def __init__(self) -> None:
        super().__init__()
        self._service = ProviderService()

    def compose(self) -> ComposeResult:
        with Horizontal(id="provider-main"):
            with Vertical(id="provider-list"):
                yield Label("Provider 列表", id="provider-list-title")
                yield ListView(id="provider-lv")
            with VerticalScroll(id="provider-detail"):
                yield Label("选择左侧 Provider 查看详情", id="provider-detail-label")
        with Horizontal(id="provider-actions"):
            yield Button("添加(a)", id="btn-add", variant="primary")
            yield Button("编辑(e)", id="btn-edit")
            yield Button("删除(del)", id="btn-delete", variant="error")
            yield Button("测试连接(t)", id="btn-test", variant="warning")
            yield Button("设为默认(d)", id="btn-default")
            yield Button("刷新(r)", id="btn-refresh")
        yield Label("", id="provider-status")

    def on_mount(self) -> None:
        self._refresh_list()

    # ── 数据刷新 ───────────────────────────────────────────────────

    def _refresh_list(self, select_id: str | None = None) -> None:
        """重建列表，可选高亮指定 ID。"""
        providers = self._service.list_providers()
        active = self._service.get_active()
        active_id = active.id if active else None

        lv = self.query_one("#provider-lv", ListView)
        lv.clear()
        for p in providers:
            item = _provider_display(p, active_id)
            # id 用 lv-{provider.id}，便于按 id 定位
            li = ListItem(Label(item), id=f"lv-{p.id}")
            lv.append(li)

        if select_id:
            try:
                idx = next(i for i, p in enumerate(providers) if p.id == select_id)
                lv.index = idx
            except StopIteration:
                pass
        elif providers:
            lv.index = 0

        self._update_detail()

    def _update_detail(self) -> None:
        """根据当前选中项更新右侧详情。"""
        label = self.query_one("#provider-detail-label", Label)
        provider = self._selected_provider()
        if provider is None:
            label.update("选择左侧 Provider 查看详情")
            return
        active = self._service.get_active()
        active_id = active.id if active else None
        label.update(_provider_detail_text(provider, active_id))

    def _selected_provider(self) -> AIProvider | None:
        """返回当前选中的 Provider，无选中返回 None。"""
        lv = self.query_one("#provider-lv", ListView)
        if lv.index is None:
            return None
        providers = self._service.list_providers()
        if 0 <= lv.index < len(providers):
            return providers[lv.index]
        return None

    def _set_status(self, text: str) -> None:
        self.query_one("#provider-status", Label).update(text)

    # ── 事件 ───────────────────────────────────────────────────────

    @on(ListView.Selected)
    def _on_list_selected(self, _event: ListView.Selected) -> None:
        self._update_detail()

    @on(Button.Pressed, "#btn-refresh")
    def action_refresh(self) -> None:
        self._refresh_list()
        self._set_status("已刷新")

    @on(Button.Pressed, "#btn-add")
    def action_add(self) -> None:
        def _on_result(result: dict[str, Any] | None) -> None:
            if result and result.get("saved"):
                provider = result["provider"]
                self._refresh_list(select_id=provider.id)
                self._set_status(f"已添加: {provider.name} ({provider.id})")

        self.app.push_screen(ProviderFormModal(self._service), _on_result)

    @on(Button.Pressed, "#btn-edit")
    def action_edit(self) -> None:
        provider = self._selected_provider()
        if provider is None:
            self._set_status("请先选择一个 Provider")
            return

        def _on_result(result: dict[str, Any] | None) -> None:
            if result and result.get("saved"):
                updated = result["provider"]
                self._refresh_list(select_id=updated.id)
                self._set_status(f"已更新: {updated.name}")

        self.app.push_screen(ProviderFormModal(self._service, edit_provider=provider), _on_result)

    @on(Button.Pressed, "#btn-delete")
    def action_delete(self) -> None:
        provider = self._selected_provider()
        if provider is None:
            self._set_status("请先选择一个 Provider")
            return

        def _on_result(confirmed: bool) -> None:
            if confirmed:
                if self._service.delete(provider.id):
                    self._refresh_list()
                    self._set_status(f"已删除: {provider.name}")
                else:
                    self._set_status(f"删除失败: {provider.id}")

        self.app.push_screen(
            ConfirmModal(f"确认删除 Provider「{provider.name}({provider.id})」？"),
            _on_result,
        )

    @on(Button.Pressed, "#btn-default")
    def action_set_default(self) -> None:
        provider = self._selected_provider()
        if provider is None:
            self._set_status("请先选择一个 Provider")
            return
        if self._service.set_active(provider.id):
            self._refresh_list(select_id=provider.id)
            self._set_status(f"已设为默认: {provider.name}")
        else:
            self._set_status(f"设置失败: {provider.id}")

    @on(Button.Pressed, "#btn-test")
    def action_test(self) -> None:
        provider = self._selected_provider()
        if provider is None:
            self._set_status("请先选择一个 Provider")
            return
        self._run_connection_test(provider)

    def _run_connection_test(self, provider: AIProvider) -> None:
        """异步测试连接，结果更新到状态栏。

        用 Textual 的 run_worker（thread=False，在事件循环内）执行 service 的异步
        test_connection，避免阻塞 UI。
        """
        self._set_status(f"测试中: {provider.name} ...")
        test_btn = self.query_one("#btn-test", Button)
        test_btn.disabled = True

        async def _do_test() -> dict[str, Any]:
            return await self._service.test_connection(provider.id)

        def _on_done(result: dict[str, Any]) -> None:
            test_btn.disabled = False
            if result.get("status") == "ok":
                latency = result.get("latency_ms")
                self._set_status(f"[{provider.name}] 连接正常 ({latency}ms)")
            else:
                err = result.get("error") or "未知错误"
                self._set_status(f"[{provider.name}] 连接失败: {err}")

        worker = self.run_worker(_do_test(), exclusive=True, group="provider-test")
        worker.add_done_callback(lambda w: _on_done(w.result))


class ProviderFormModal(ModalScreen[dict[str, Any] | None]):
    """添加/编辑 Provider 的表单弹窗。

    添加模式：Select 预设（必选）+ 模型 + 名称 + API Key + context_window。
    编辑模式：锁定预设（不可改类型/端点），可改 名称/模型/API Key/context_window，
    字段预填当前值。

    返回 ``{"saved": True, "provider": AIProvider}`` 或 None（取消）。
    """

    DEFAULT_CSS = """
    ProviderFormModal {
        align: center middle;
    }
    #provider-form {
        width: 70;
        height: auto;
        border: solid $accent;
        padding: 1 2;
        background: $surface;
    }
    #provider-form Button {
        margin-top: 1;
    }
    .form-row {
        height: 3;
        margin-bottom: 0;
    }
    .form-label {
        color: $text-muted;
        height: 1;
    }
    """

    def __init__(self, service: ProviderService, edit_provider: AIProvider | None = None) -> None:
        super().__init__()
        self._service = service
        self._edit = edit_provider
        self._presets = service.list_presets()

    def compose(self) -> ComposeResult:
        title = "编辑 Provider" if self._edit else "添加 Provider"
        yield Vertical(
            Label(title, id="form-title"),
            self._form_rows(),
            Horizontal(
                Button("保存", id="form-save", variant="primary"),
                Button("取消", id="form-cancel"),
                id="form-buttons",
            ),
            id="provider-form",
        )

    def _form_rows(self) -> Vertical:
        """构造表单字段行。"""
        rows: list[Any] = []

        # 预设 Select（仅添加模式可改）
        if self._edit is None:
            options = [(f"{p['name']} ({p['type']})", p["id"]) for p in self._presets]
            rows.append(Label("服务商预设", classes="form-label"))
            rows.append(Select(options, id="f-preset", prompt="选择预设"))
        else:
            ptype = self._edit.type.value if hasattr(self._edit.type, "value") else str(self._edit.type)
            rows.append(Label(f"类型: {ptype}（不可修改）", classes="form-label"))

        # 名称
        rows.append(Label("名称", classes="form-label"))
        rows.append(Input(value=self._edit.name if self._edit else "", id="f-name", placeholder="显示名称"))

        # 模型
        default_model = self._edit.model if self._edit else ""
        rows.append(Label("模型", classes="form-label"))
        rows.append(Input(value=default_model, id="f-model", placeholder="模型名"))

        # API Key
        rows.append(Label("API Key（留空=不配置/保持）", classes="form-label"))
        rows.append(
            Input(
                value=self._edit.api_key or "",
                id="f-apikey",
                password=True,
                placeholder="sk-...",
            )
        )

        # context_window
        cw_val = str(self._edit.context_window) if self._edit and self._edit.context_window else ""
        rows.append(Label("上下文窗口 tokens（留空=自动探测）", classes="form-label"))
        rows.append(Input(value=cw_val, id="f-context", placeholder="如 8192"))

        return Vertical(*rows)

    @on(Select.Changed)
    def _on_preset_changed(self, event: Select.Changed) -> None:
        """选择预设后，预填模型与名称（仅添加模式）。"""
        if event.control.id != "f-preset" or event.value is Select.NULL:
            return
        preset = next((p for p in self._presets if p["id"] == event.value), None)
        if preset is None:
            return
        model_input = self.query_one("#f-model", Input)
        name_input = self.query_one("#f-name", Input)
        # 仅当用户未输入时才预填
        if not model_input.value:
            model_input.value = preset["default_model"]
        if not name_input.value:
            name_input.value = preset["name"]

    @on(Button.Pressed, "#form-cancel")
    def _on_cancel(self, _event: Button.Pressed) -> None:
        self.dismiss(None)

    @on(Button.Pressed, "#form-save")
    def _on_save(self, _event: Button.Pressed) -> None:
        try:
            provider = self._collect_and_save()
        except ValueError as e:
            self.app.bell()
            # 在标题下方提示错误
            self.query_one("#form-title", Label).update(f"[保存失败] {e}")
            return
        self.dismiss({"saved": True, "provider": provider})

    def _collect_and_save(self) -> AIProvider:
        """收集表单字段并调用 service 保存。校验失败抛 ValueError。"""
        name = self.query_one("#f-name", Input).value.strip()
        model = self.query_one("#f-model", Input).value.strip()
        api_key = self.query_one("#f-apikey", Input).value.strip() or None
        cw_raw = self.query_one("#f-context", Input).value.strip()

        context_window: int | None = None
        if cw_raw:
            try:
                context_window = int(cw_raw)
            except ValueError as e:
                raise ValueError("上下文窗口必须为整数") from e

        if self._edit is not None:
            # 编辑模式：name/model 空则保持原值
            if not name:
                name = self._edit.name
            if not model:
                model = self._edit.model
            # api_key 留空且原本有值 → 保持原值（不清空）；显式想清空需输入后删空再保存
            if api_key is None and self._edit.api_key:
                api_key = self._edit.api_key
            return self._service.update(
                self._edit.id,
                name=name,
                model=model,
                api_key=api_key,
                context_window=context_window,
            )

        # 添加模式：必须选预设
        preset_select = self.query_one("#f-preset", Select)
        if preset_select.value is Select.NULL:
            raise ValueError("请选择服务商预设")
        preset_id = str(preset_select.value)
        return self._service.add(
            preset_id,
            model=model or None,
            name=name or None,
            api_key=api_key,
            context_window=context_window,
        )


class ConfirmModal(ModalScreen[bool]):
    """通用确认弹窗，dismiss(True) 表示确认，dismiss(False) 表示取消。"""

    DEFAULT_CSS = """
    ConfirmModal {
        align: center middle;
    }
    #confirm-box {
        width: 60;
        height: auto;
        border: solid $warning;
        padding: 1 2;
        background: $surface;
    }
    #confirm-buttons Button {
        margin-right: 2;
    }
    """

    def __init__(self, message: str) -> None:
        super().__init__()
        self._message = message

    def compose(self) -> ComposeResult:
        yield Vertical(
            Label(self._message, id="confirm-msg"),
            Horizontal(
                Button("确认", id="confirm-yes", variant="warning"),
                Button("取消", id="confirm-no"),
                id="confirm-buttons",
            ),
            id="confirm-box",
        )

    @on(Button.Pressed, "#confirm-yes")
    def _on_yes(self, _event: Button.Pressed) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#confirm-no")
    def _on_no(self, _event: Button.Pressed) -> None:
        self.dismiss(False)


__all__ = ["ProviderScreen", "ProviderFormModal", "ConfirmModal"]
