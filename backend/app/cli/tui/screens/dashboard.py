# backend/app/cli/tui/screens/dashboard.py
"""@fileoverview TUI 首页看板屏（P6 · 看板化改造）

功能概述:
- 作为 ``on_mount`` 的默认屏：状态横幅 + 横向功能卡片 + 最近项目 + 快捷键提示。
- 功能屏入口用 ``OptionList``（``#quick-entries``）：选中后 ``post_message(GotoScreen)``，
  由 App 接收并跳转。OptionList 经 CSS 横向排列、卡片化样式，呈现现代仪表盘观感。
- 最近项目用另一个 ``OptionList``（数据来自 ``project_ops.load_history``），
  选中后经 ``project_ops.open_project`` 打开并更新全局项目状态。

架构设计:
- 通过 ``@register_screen("dashboard")`` 注册到 SCREEN_REGISTRY（命令面板也能跳回首页）。
- 项目状态读取走 ``self.app``（ProjectState 协议，由 App 实现）。
- 不直接 ``push_screen``（避免与 App 装配耦合），改用消息把意图上抛；App 统一处理跳转，
  保证状态栏刷新等全局副作用集中在一处。
- 启动 logo 动画已移至 SplashScreen，Dashboard 仅保留小号标题，避免重复与大片空白。

复用（只读 import）:
- ``project_ops`` — 历史/打开/标签解析（shared_services）
- ``register_screen`` — tui.protocols
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version
from typing import TYPE_CHECKING

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.screen import Screen
from textual.widgets import Label, OptionList
from textual.widgets.option_list import Option

from app.cli.shared_services import project_ops
from app.cli.tui.protocols import register_screen

if TYPE_CHECKING:
    pass


# 版本号：优先从包元数据读取，失败则回退硬编码 v0.1.0。
# TODO(P0): 上线打包后改为在 app/__init__.py 暴露 __version__ 统一来源。
try:
    _APP_VERSION: str = f"v{_pkg_version('precis')}"
except PackageNotFoundError:  # 包未安装（开发模式 / 测试环境）
    _APP_VERSION = "v0.1.0"
except Exception:  # noqa: BLE001 - 保守兜底，避免任何元数据异常拖垮启动
    _APP_VERSION = "v0.1.0"


# 功能屏快捷入口：(显示文案, 屏注册名, 数字快捷键)。
# 仅列已在 SCREEN_REGISTRY 的屏，未注册的屏会被跳过（防御未来某屏被移除的情况）。
# 图标用 Unicode 符号（不用 emoji），便于跨字体渲染。
_QUICK_ENTRIES: list[tuple[str, str, str]] = [
    ("▸ 校验", "validation", "1"),
    ("⚙ Provider", "provider", "2"),
    ("▷ 配置", "config", "3"),
    ("✦ 对话", "chat", "4"),
    ("▼ 生成", "generate", "5"),
    ("→ 迁移", "migrate", "6"),
]

# 快捷键提示文本：填充底部右栏，让看板不留大片空白。
_TIPS_TEXT: str = (
    "[bold $accent]快捷键[/bold $accent]\n"
    "\n"
    "  [dim]Ctrl+P[/dim]  命令面板\n"
    "  [dim]F2[/dim]      切换主题\n"
    "  [dim]Ctrl+O[/dim]  打开项目\n"
    "  [dim]Ctrl+Q[/dim]  退出\n"
    "\n"
    "  [dim]数字键 1-6[/dim] 快速进入功能\n"
    "  [dim]Enter[/dim]      确认选择"
)


@register_screen("dashboard")
class DashboardScreen(Screen):
    """首页看板屏：状态横幅 + 横向功能卡片 + 最近项目 + 快捷键提示。

    布局：顶部小号标题 + 状态横幅 + 横向功能卡片 + 底部双栏（左：最近项目；右：快捷键提示）。
    通过 ``GotoScreen`` 消息把跳转意图发给 App；通过 ``OpenHistory`` 消息把
    打开历史项目的意图发给 App（统一在 App 处理项目状态更新与状态栏刷新）。
    """

    BINDINGS = [
        Binding("escape", "app.bell", "返回", show=False),
        Binding("1", "select_entry(0)", "校验", show=False),
        Binding("2", "select_entry(1)", "Provider", show=False),
        Binding("3", "select_entry(2)", "配置", show=False),
        Binding("4", "select_entry(3)", "对话", show=False),
        Binding("5", "select_entry(4)", "生成", show=False),
        Binding("6", "select_entry(5)", "迁移", show=False),
    ]

    DEFAULT_CSS = """
    DashboardScreen {
        layout: vertical;
        background: transparent;
    }
    #dashboard-root {
        padding: 1 2;
        layout: vertical;
        background: transparent;
    }
    /* 顶部小号标题：单行 PRECIS + 版本，不再做大 logo（Splash 已接管启动动画）。 */
    #dashboard-title {
        text-align: center;
        color: $primary;
        text-style: bold;
        margin-bottom: 1;
        height: 1;
    }
    /* 状态横幅：靠背景色区分，无边框。 */
    #status-banner {
        background: $boost;
        padding: 1 2;
        margin-bottom: 1;
        height: auto;
    }
    #banner-content {
        background: transparent;
    }
    /* 功能入口横向卡片区：OptionList 横向排列成卡片样式。 */
    #feature-cards {
        height: auto;
        margin-bottom: 1;
        background: transparent;
    }
    #quick-entries {
        width: 100%;
        height: auto;
        background: transparent;
        /* 横向布局让选项变成一排卡片 */
        layout: horizontal;
        /* 隐藏 OptionList 自带的滚动内边距，让卡片贴近排列 */
        padding: 0;
    }
    /* 每个 Option 渲染为卡片：宽度自适应、面板背景、hover 高亮。 */
    #quick-entries > .option-list--option {
        width: 1fr;
        min-width: 14;
        height: 3;
        padding: 1 1;
        background: $panel;
        margin: 0 1 0 0;
        text-align: center;
        color: $text;
        text-style: bold;
    }
    #quick-entries > .option-list--option:hover {
        background: $boost;
        color: $primary;
    }
    #quick-entries > .option-list--option-highlighted {
        background: $boost;
        color: $primary;
    }
    /* 底部双栏：填满剩余空间，左右各一卡片。 */
    #dashboard-bottom {
        height: 1fr;
        background: transparent;
    }
    #recent-section {
        width: 1fr;
        height: 100%;
        background: $panel;
        padding: 0 1;
        margin-right: 1;
    }
    #tips-section {
        width: 1fr;
        height: 100%;
        background: $panel;
        padding: 1 1;
    }
    /* 分区小标题。 */
    .section-title {
        text-style: bold;
        color: $accent;
        margin: 1 0;
        height: 1;
    }
    #tips-text {
        color: $text;
    }
    """

    def compose(self) -> ComposeResult:
        """组装首页看板：标题 + 状态横幅 + 横向功能卡片 + 底部双栏。"""
        with Vertical(id="dashboard-root"):
            # 小号标题（单行，不做大 logo 动画）
            yield Label(f"PRECIS  [dim]{_APP_VERSION}[/dim]", id="dashboard-title", markup=True)
            # 状态横幅：项目名/路径 或 未打开引导
            with Vertical(id="status-banner"):
                yield Label("项目概览", id="banner-content", markup=True)
            # 横向功能卡片
            with Horizontal(id="feature-cards"):
                yield OptionList(id="quick-entries")
            # 底部双栏：最近项目 + 快捷键提示
            with Horizontal(id="dashboard-bottom"):
                with Vertical(id="recent-section"):
                    yield Label("最近项目", classes="section-title")
                    yield OptionList(id="recent-projects")
                with Vertical(id="tips-section"):
                    yield Label(_TIPS_TEXT, id="tips-text", markup=True)

    def on_mount(self) -> None:
        """挂载时填充快捷入口与最近项目列表，并刷新横幅。"""
        entries = self.query_one("#quick-entries", OptionList)
        for idx, (label, name, _key) in enumerate(_QUICK_ENTRIES, start=1):
            # 卡片文案：图标+名称 一行；第二行 dim 数字键。
            entries.add_option(Option(f"{label}\n[dim]{idx}[/dim]", id=name))

        self._reload_history()
        self._refresh_overview()

    def on_screen_resume(self) -> None:
        """Dashboard 成为活动屏时启动星空背景。"""
        if hasattr(self.app, "set_fx_background"):
            self.app.set_fx_background("starfield")

    def on_screen_suspend(self) -> None:
        """Dashboard 离开活动屏时清除背景特效。"""
        if hasattr(self.app, "set_fx_background"):
            self.app.set_fx_background(None)

    def _reload_history(self) -> None:
        """重新加载最近项目列表（从 project_ops.load_history）。"""
        history_list = self.query_one("#recent-projects", OptionList)
        history_list.clear_options()
        history = project_ops.load_history()
        if not history:
            history_list.add_option(Option("（暂无历史项目 · 按 Ctrl+O 打开项目）", id="__empty__", disabled=True))
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
        """刷新状态横幅文案（替代旧 #dashboard-overview）。"""
        banner = self.query_one("#banner-content", Label)
        path = getattr(self.app, "project_path", None)
        if not path:
            banner.update(
                "[yellow]○ 未打开项目[/yellow]  "
                "[dim]按 Ctrl+O 或从下方选择项目目录[/dim]\n"
                "[dim]数字键 1-6 可快速进入功能入口[/dim]"
            )
            return
        try:
            label = project_ops.resolve_project_label(path)
        except Exception:  # noqa: BLE001
            label = path
        banner.update(
            f"[green]●[/green] [bold]{label}[/bold]  [dim]{path}[/dim]\n"
            f"[dim]按 Ctrl+P 打开命令面板，或从下方功能卡片选择操作。[/dim]"
        )

    def action_select_entry(self, index: str) -> None:
        """数字快捷键选中功能入口并跳转。

        Args:
            index: 入口索引（来自绑定字符串，0 开始）。
        """
        try:
            idx = int(index)
        except ValueError:
            return
        if not (0 <= idx < len(_QUICK_ENTRIES)):
            return
        self.post_message(self.GotoScreen(name=_QUICK_ENTRIES[idx][1]))

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
        """供 App 在项目状态变化后调用，刷新横幅与最近项目列表。"""
        self._reload_history()
        self._refresh_overview()


__all__ = ["DashboardScreen"]
