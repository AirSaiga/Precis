# backend/app/cli/tui/screens/dashboard.py
"""@fileoverview TUI 首页屏（P6）

功能概述:
- 作为 ``on_mount`` 的默认屏：项目概览 + 功能屏快捷入口 + 最近项目历史。
- 功能屏入口用 ``OptionList``：选中后 ``post_message(GotoScreen)``，由 App 接收并跳转。
- 最近项目用另一个 ``OptionList``（数据来自 ``project_ops.load_history``），
  选中后经 ``project_ops.open_project`` 打开并更新全局项目状态。

架构设计:
- 通过 ``@register_screen("dashboard")`` 注册到 SCREEN_REGISTRY（命令面板也能跳回首页）。
- 项目状态读取走 ``self.app``（ProjectState 协议，由 App 实现）。
- 不直接 ``push_screen``（避免与 App 装配耦合），改用消息把意图上抛；App 统一处理跳转，
  保证状态栏刷新等全局副作用集中在一处。

复用（只读 import）:
- ``project_ops`` — 历史/打开/标签解析（shared_services）
- ``register_screen`` — tui.protocols
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.message import Message
from textual.screen import Screen
from textual.widgets import Label, OptionList
from textual.widgets.option_list import Option

from app.cli.shared_services import project_ops
from app.cli.tui.protocols import register_screen

if TYPE_CHECKING:
    pass


# 功能屏快捷入口：(显示文案, 屏注册名)。仅列已在 SCREEN_REGISTRY 的屏，
# 未注册的屏会被跳过（防御未来某屏被移除的情况）。
_QUICK_ENTRIES: list[tuple[str, str]] = [
    ("校验项目 (validation)", "validation"),
    ("管理 Provider (provider)", "provider"),
    ("配置管理 (config)", "config"),
    ("AI 对话 (chat)", "chat"),
    ("生成配置 (generate)", "generate"),
    ("迁移脚本 (migrate)", "migrate"),
]


@register_screen("dashboard")
class DashboardScreen(Screen):
    """首页屏：项目概览 + 快捷入口 + 最近项目。

    布局：顶部项目概览 + 下方两栏（左：功能入口；右：最近项目）。
    通过 ``GotoScreen`` 消息把跳转意图发给 App；通过 ``OpenHistory`` 消息把
    打开历史项目的意图发给 App（统一在 App 处理项目状态更新与状态栏刷新）。
    """

    BINDINGS = [
        Binding("escape", "app.bell", "返回", show=False),
    ]

    DEFAULT_CSS = """
    DashboardScreen {
        layout: vertical;
        padding: 0 1;
    }
    #dashboard-overview {
        height: auto;
        margin-bottom: 1;
        border: round $primary;
        padding: 0 1;
    }
    #dashboard-panels {
        height: 1fr;
    }
    #dashboard-entries {
        width: 1fr;
        height: 100%;
        border: solid $accent;
        padding: 0 1;
        margin-right: 1;
    }
    #dashboard-history {
        width: 1fr;
        height: 100%;
        border: solid $accent;
        padding: 0 1;
    }
    .section-title {
        text-style: bold;
        color: $accent;
        margin-bottom: 1;
    }
    """

    def compose(self) -> ComposeResult:
        """组装首页：概览 + 双栏（功能入口 / 最近项目）。"""
        yield Label("项目概览", id="dashboard-overview", markup=True)
        with Horizontal(id="dashboard-panels"):
            with VerticalScroll(id="dashboard-entries"):
                yield Label("功能入口", classes="section-title")
                yield OptionList(id="quick-entries")
            with VerticalScroll(id="dashboard-history"):
                yield Label("最近项目", classes="section-title")
                yield OptionList(id="recent-projects")

    def on_mount(self) -> None:
        """挂载时填充快捷入口与最近项目列表，并刷新概览。"""
        entries = self.query_one("#quick-entries", OptionList)
        for label, name in _QUICK_ENTRIES:
            entries.add_option(Option(label, id=name))

        self._reload_history()
        self._refresh_overview()

    def _reload_history(self) -> None:
        """重新加载最近项目列表（从 project_ops.load_history）。"""
        history_list = self.query_one("#recent-projects", OptionList)
        history_list.clear_options()
        history = project_ops.load_history()
        if not history:
            history_list.add_option(Option("（暂无历史项目）", id="__empty__"))
            return
        for item in history:
            path = item.get("path")
            if not path:
                continue
            try:
                label = project_ops.resolve_project_label(path)
            except Exception:  # noqa: BLE001 - 列表兜底，降级显示路径
                label = path
            # 显示名 + 暗淡路径，id 用路径本身（打开时直接取）
            history_list.add_option(Option(f"{label}\n[dim]{path}[/dim]", id=path))

    def _refresh_overview(self) -> None:
        """刷新顶部项目概览文案。"""
        overview = self.query_one("#dashboard-overview", Label)
        path = getattr(self.app, "project_path", None)
        if not path:
            overview.update("[yellow]○ 未打开项目[/yellow]\n\n打开下方「最近项目」或按 Ctrl+O 选择项目目录。")
            return
        try:
            label = project_ops.resolve_project_label(path)
        except Exception:  # noqa: BLE001
            label = path
        overview.update(
            f"[green]●[/green] [bold]{label}[/bold]\n"
            f"[dim]{path}[/dim]\n\n"
            f"按 Ctrl+P 打开命令面板，或从左侧功能入口选择操作。"
        )

    @on(OptionList.OptionSelected, "#quick-entries")
    def _on_entry_selected(self, event: OptionList.OptionSelected) -> None:
        """功能入口被选中：发 GotoScreen 消息让 App 跳转。"""
        event.stop()
        self.post_message(self.GotoScreen(name=event.option.id or ""))

    @on(OptionList.OptionSelected, "#recent-projects")
    def _on_history_selected(self, event: OptionList.OptionSelected) -> None:
        """最近项目被选中：发 OpenHistory 消息让 App 打开并刷新状态。"""
        event.stop()
        path = event.option.id or ""
        if path == "__empty__":
            return
        self.post_message(self.OpenHistory(path=path))

    class GotoScreen(Message):
        """请求 App 跳转到指定功能屏。

        Attributes:
            name: 目标屏在 SCREEN_REGISTRY 中的注册名。
        """

        def __init__(self, name: str) -> None:
            super().__init__()
            self.name: str = name
            """目标屏注册名。"""

    class OpenHistory(Message):
        """请求 App 打开历史项目并更新全局状态。

        Attributes:
            path: 待打开项目的绝对路径。
        """

        def __init__(self, path: str) -> None:
            super().__init__()
            self.path: str = path
            """待打开项目的绝对路径。"""

    def refresh_overview(self) -> None:
        """供 App 在项目状态变化后调用，刷新概览与最近项目列表。"""
        self._reload_history()
        self._refresh_overview()


__all__ = ["DashboardScreen"]
