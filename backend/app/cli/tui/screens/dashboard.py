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

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version
from typing import TYPE_CHECKING

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.message import Message
from textual.screen import Screen
from textual.timer import Timer
from textual.widgets import Label, OptionList
from textual.widgets.option_list import Option

from app.cli.shared_services import project_ops
from app.cli.tui.protocols import register_screen

if TYPE_CHECKING:
    pass


# ── 启动 Logo（ASCII art "PRECIS"）──────────────────────────────────────
# 紧凑的 5 行 block 字体 logo（参考 gitui/yazi 启动屏风格）：
# 每个字母 5 列宽、字母间 1 个空格，整行 35 列，适配 80 列终端。
# 行数固定，便于动画时按行 / 按字符着色。
_LOGO_ART: str = (
    "█████ ████  █████ ████  █████ ████ \n"
    "█   █ █   █ █     █       █   █    \n"
    "█████ ████  █████ █       █   ████ \n"
    "█     █ █   █     █       █       █\n"
    "█     █  █  █████ ████  █████ ████ "
)

# 版本号：优先从包元数据读取，失败则回退硬编码 v0.1.0。
# TODO(P0): 上线打包后改为在 app/__init__.py 暴露 __version__ 统一来源。
try:
    _APP_VERSION: str = f"v{_pkg_version('precis')}"
except PackageNotFoundError:  # 包未安装（开发模式 / 测试环境）
    _APP_VERSION = "v0.1.0"
except Exception:  # noqa: BLE001 - 保守兜底，避免任何元数据异常拖垮启动
    _APP_VERSION = "v0.1.0"

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
        padding: 0 1;
        background: transparent;
    }
    #dashboard-hero {
        height: auto;
        margin: 1 0 0 0;
        padding: 0 1;
        text-align: center;
        color: $text-muted;
        text-style: bold;
        background: transparent;
    }
    #dashboard-hero .logo-version {
        color: $text-muted;
        text-style: italic;
        margin-top: 1;
    }
    #dashboard-overview {
        height: auto;
        margin-bottom: 1;
        border: round $primary;
        background: $surface 85%;
        padding: 1 2;
    }
    #dashboard-panels {
        height: 1fr;
    }
    #dashboard-entries {
        width: 1fr;
        height: 100%;
        border: round $accent;
        background: $surface 85%;
        padding: 0 1;
        margin-right: 1;
    }
    #dashboard-history {
        width: 1fr;
        height: 100%;
        border: round $accent;
        background: $surface 85%;
        padding: 0 1;
    }
    .section-title {
        text-style: bold;
        color: $accent;
        margin: 1 0;
    }
    """

    def compose(self) -> ComposeResult:
        """组装首页：Hero 标题 + 概览 + 双栏（功能入口 / 最近项目）。"""
        # 初始以「全灰」状态渲染 logo，on_mount 后由渐变动画逐字点亮到强调色。
        yield Label(self._render_logo(step=0), id="dashboard-hero", markup=True)
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
        for idx, (label, name) in enumerate(_QUICK_ENTRIES, start=1):
            entries.add_option(Option(f"{idx}. {label}", id=name))

        self._reload_history()
        self._refresh_overview()
        # 启动 logo 渐变动画（~800ms / 8 帧 × 100ms），完成后定时器自动停止。
        self._hero_step: int = 0
        self._hero_timer: Timer = self.set_interval(0.1, self._tick_hero, name="dashboard-hero-animation")

    # ── Hero logo 动画 ──────────────────────────────────────────────────
    # 总帧数：8（step 0..7）。每帧把「已点亮」字符数递增，从左到右逐字从
    # 灰色（$text-muted）过渡到主题强调色（$accent）。
    # 渐变色用一个调色板在灰→蓝之间插值，营造平滑的「点亮」感。
    _HERO_TOTAL_STEPS: int = 8
    # logo 中非空格字符总数（与 _LOGO_ART 保持同步，用于按进度计算点亮前缀长度）。
    _HERO_TOTAL_CHARS: int = 83
    # 动画调色板：从暗灰过渡到主题强调色蓝（#7aa2f7，与 tokyo-night 主题一致）。
    _HERO_PALETTE: tuple[str, ...] = (
        "#565f89",  # 暗灰蓝（text-muted 附近）
        "#6b7394",
        "#7e84a0",
        "#8195b0",
        "#7aa2f7",  # 主题强调蓝（accent）
    )

    def _tick_hero(self) -> None:
        """set_interval 回调：推进一帧并更新 hero，到达终点后停掉定时器。"""
        self._hero_step += 1
        if self._hero_step >= self._HERO_TOTAL_STEPS:
            # 动画完成：渲染最终强调色态并停止定时器，避免无限触发。
            hero = self.query_one("#dashboard-hero", Label)
            hero.update(self._render_logo(step=self._HERO_TOTAL_STEPS))
            self._hero_timer.stop()
            return
        hero = self.query_one("#dashboard-hero", Label)
        hero.update(self._render_logo(step=self._hero_step))

    def _render_logo(self, step: int) -> str:
        """根据动画进度渲染带 Rich markup 的 logo 文本。

        动画采用「从左到右逐字点亮」效果：进度推进时，已点亮字符按其在调色板
        上的位置取色（越靠右越接近强调色），未点亮字符保持暗灰；最后一帧整个
        logo 统一显示主题强调色（满足「完成后显示最终强调色」的验收要求）。

        Args:
            step: 动画进度（0 = 全灰静止态；>= 总帧数 = 全强调色态）。

        Returns:
            多行 Rich markup 字符串：彩色 logo + 版本号小字。
        """
        palette = self._HERO_PALETTE
        accent = palette[-1]
        grey = palette[0]
        # 进度归一化到 [0, 1]，step 达总帧数时为 1.0（全强调色）。
        progress = max(0.0, min(1.0, step / self._HERO_TOTAL_STEPS))
        lit_count = int(self._HERO_TOTAL_CHARS * progress)

        def color_for(index: int) -> str:
            """返回该字符颜色：未点亮→暗灰；已点亮→按位置在灰→强调色间插值。"""
            if progress >= 1.0:
                # 最终帧：统一强调色，干净收尾。
                return accent
            if index >= lit_count:
                return grey
            # 已点亮字符：按其在「已点亮区段」内的相对位置插值取色，
            # 使点亮边缘呈现亮带、向左逐渐变暗，形成从左到右的渐变扫光。
            t = index / max(1, self._HERO_TOTAL_CHARS - 1)
            pos = int(t * (len(palette) - 1))
            return palette[pos]

        rendered_lines: list[str] = []
        char_index = 0
        for line in _LOGO_ART.split("\n"):
            parts: list[str] = []
            for ch in line:
                if ch == " ":
                    parts.append(" ")
                    continue
                parts.append(f"[{color_for(char_index)}]{ch}[/]")
                char_index += 1
            rendered_lines.append("".join(parts))
        logo_block = "\n".join(rendered_lines)
        return f"{logo_block}\n[dim italic]{_APP_VERSION}[/]"

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
        """刷新顶部项目概览文案。"""
        overview = self.query_one("#dashboard-overview", Label)
        path = getattr(self.app, "project_path", None)
        if not path:
            overview.update(
                "[yellow]○ 未打开项目[/yellow]\n"
                "[dim]打开下方「最近项目」或按 Ctrl+O 选择项目目录。[/dim]\n"
                "[dim]数字键 1-6 可快速进入功能入口。[/dim]"
            )
            return
        try:
            label = project_ops.resolve_project_label(path)
        except Exception:  # noqa: BLE001
            label = path
        overview.update(
            f"[green]●[/green] [bold]{label}[/bold]\n"
            f"[dim]{path}[/dim]\n"
            f"按 Ctrl+P 打开命令面板，或从左侧功能入口选择操作。"
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
        """供 App 在项目状态变化后调用，刷新概览与最近项目列表。"""
        self._reload_history()
        self._refresh_overview()


__all__ = ["DashboardScreen"]
