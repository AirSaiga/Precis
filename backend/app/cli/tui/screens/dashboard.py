# backend/app/cli/tui/screens/dashboard.py
"""@fileoverview TUI 首页看板屏（P9 · Dashboard 2.0 卡片网格升级）

功能概述:
- 作为 ``on_mount`` 的默认屏：状态横幅 + 功能卡片网格 + 最近项目 + 动态提示。
- 功能屏入口改为自定义 ``DashboardCard``：6 张卡片以 2 行 × 3 列网格排列，
  支持方向键、Tab、Enter 和数字键 1-6 导航。
- 最近项目用 ``OptionList`` 展示为带图标的列表项。
- 通过 ``GotoScreen`` / ``OpenHistory`` 消息与 App 解耦。

架构设计:
- 通过 ``@register_screen("dashboard")`` 注册到 SCREEN_REGISTRY。
- 项目状态读取走 ``self.app``（ProjectState 协议）。
- 不直接 ``push_screen``，改用消息把意图上抛；App 统一处理跳转。
- 启动动画由 SplashScreen 负责；Dashboard 标题保持静态。
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _pkg_version
from typing import TYPE_CHECKING, Any

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.timer import Timer
from textual.widgets import Label, OptionList, Static
from textual.widgets.option_list import Option

from app.cli.shared_services import project_ops
from app.cli.tui.fx.animation import animate_tint
from app.cli.tui.protocols import register_screen
from app.cli.tui.screens.base import BaseScreen

if TYPE_CHECKING:
    pass


# 版本号：优先从包元数据读取，失败则回退硬编码 v0.1.0。
try:
    _APP_VERSION: str = f"v{_pkg_version('precis')}"
except PackageNotFoundError:  # 包未安装（开发模式 / 测试环境）
    _APP_VERSION = "v0.1.0"
except Exception:  # noqa: BLE001 - 保守兜底，避免任何元数据异常拖垮启动
    _APP_VERSION = "v0.1.0"


# 功能屏快捷入口：(屏注册名, 数字键, 图标, 显示名, 描述)。
# 仅列已在 SCREEN_REGISTRY 的屏，未注册的屏会被跳过（防御未来某屏被移除的情况）。
# 图标用 Unicode 符号（不用 emoji），便于跨字体渲染。
_QUICK_ENTRIES: list[tuple[str, str, str, str, str]] = [
    ("validation", "1", "▸", "校验", "执行项目数据校验并查看报告"),
    ("provider", "2", "⚙", "Provider", "管理 AI Provider 与模型配置"),
    ("config", "3", "▷", "配置", "编辑项目清单、Schema 与约束"),
    ("chat", "4", "✦", "对话", "与 AI 助手就项目进行对话"),
    ("generate", "5", "▼", "生成", "根据项目生成代码或文档"),
    ("migrate", "6", "→", "迁移", "项目配置迁移与版本升级"),
]

# 默认提示（当功能入口无高亮时显示）
_DEFAULT_TIPS: str = (
    "[bold]全局快捷键[/bold]\n"
    "\n"
    "  [dim]Ctrl+P[/dim]  命令面板\n"
    "  [dim]F2[/dim]      切换主题\n"
    "  [dim]F3[/dim]      切换背景\n"
    "  [dim]Ctrl+O[/dim]  打开项目\n"
    "  [dim]Ctrl+Q[/dim]  退出\n"
    "\n"
    "  [dim]方向键[/dim]    在卡片间移动\n"
    "  [dim]数字键 1-6[/dim]  快速进入功能\n"
    "  [dim]Enter[/dim]       确认选择"
)

# 网格列数（用于方向键导航计算）
_GRID_COLUMNS = 3


class DashboardCard(Static):
    """功能入口卡片。

    可聚焦，支持鼠标点击、Enter 跳转；提供 hover 上浮、focus 扫描线呼吸、
    click 脉冲高光等微交互。向上 post ``GotoScreen`` 消息。
    """

    can_focus = True

    # 点击脉冲颜色（从半透明白到透明主题色）
    PULSE_LOW = "$primary 0%"
    PULSE_HIGH = "$primary 35%"
    PULSE_DURATION = 0.25

    def __init__(self, entry: tuple[str, str, str, str, str], index: int, **kwargs) -> None:
        name, key, icon, label, desc = entry
        super().__init__(
            f"[bold $accent]{icon}[/bold $accent]  [bold]{label}[/bold]  [dim]{key}[/dim]\n[dim]{desc}[/dim]",
            classes="dashboard-card entrance-item",
            markup=True,
            **kwargs,
        )
        self.entry_name = name
        self.entry_index = index
        self._scanline_timer: Timer | None = None
        self._pulse_tween: Any | None = None

    def compose(self) -> ComposeResult:
        """在原有 Static 内容之上叠加一条扫描线。"""
        yield Static("─" * 24, classes="card-scanline")

    def on_click(self) -> None:
        """鼠标点击卡片触发脉冲高光并跳转。"""
        self._pulse_click()
        self._goto()

    def on_key(self, event) -> None:
        """Enter 触发跳转；方向键交给 Screen 统一处理。"""
        if event.key == "enter":
            event.stop()
            self._goto()

    def _goto(self) -> None:
        """向上发送跳转消息。"""
        screen = self.screen
        if isinstance(screen, DashboardScreen):
            self.post_message(screen.GotoScreen(name=self.entry_name))

    def on_focus(self) -> None:
        """获得焦点时启动扫描线呼吸并通知 Screen 刷新提示。"""
        self._restart_scanline()
        screen = self.screen
        if isinstance(screen, DashboardScreen):
            self.post_message(screen.RefreshTips(index=self.entry_index))

    def on_blur(self) -> None:
        """失去焦点时停止扫描线呼吸。"""
        self._stop_scanline()

    def on_enter(self) -> None:
        """鼠标进入时轻微上浮。"""
        try:
            self.styles.offset = (0, -1)
        except Exception:  # noqa: BLE001
            pass

    def on_leave(self) -> None:
        """鼠标离开时复位。"""
        try:
            self.styles.offset = (0, 0)
        except Exception:  # noqa: BLE001
            pass

    def _restart_scanline(self) -> None:
        """启动扫描线呼吸定时器。"""
        self._stop_scanline()
        try:
            scanline = self.query_one(".card-scanline", Static)
        except Exception:  # noqa: BLE001
            return
        scanline.remove_class("dim")
        self._scanline_timer = self.set_interval(0.5, self._toggle_scanline)

    def _stop_scanline(self) -> None:
        """停止扫描线呼吸。"""
        if self._scanline_timer is not None:
            self._scanline_timer.stop()
            self._scanline_timer = None
        try:
            scanline = self.query_one(".card-scanline", Static)
            scanline.remove_class("dim")
        except Exception:  # noqa: BLE001
            pass

    def _toggle_scanline(self) -> None:
        """切换扫描线 dim 类实现呼吸。"""
        try:
            scanline = self.query_one(".card-scanline", Static)
        except Exception:  # noqa: BLE001
            self._stop_scanline()
            return
        scanline.toggle_class("dim")

    def _pulse_click(self) -> None:
        """点击时给卡片一个短暂 tint 脉冲。"""
        if self._pulse_tween is not None:
            try:
                self._pulse_tween.stop()
            except Exception:  # noqa: BLE001
                pass
        try:
            self.styles.tint = self.PULSE_HIGH
            self._pulse_tween = animate_tint(
                self,
                self.PULSE_HIGH,
                self.PULSE_LOW,
                duration=self.PULSE_DURATION,
            )
        except Exception:  # noqa: BLE001 - widget 可能已失效
            self._pulse_tween = None

    def on_unmount(self) -> None:
        """卸载时清理定时器与动画。"""
        self._stop_scanline()
        if self._pulse_tween is not None:
            try:
                self._pulse_tween.stop()
            except Exception:  # noqa: BLE001
                pass
            self._pulse_tween = None


@register_screen("dashboard")
class DashboardScreen(BaseScreen):
    """首页看板屏：状态横幅 + 功能卡片网格 + 最近项目 + 动态提示。

    布局：顶部标题/状态栏 + 中部功能入口卡片网格 + 底部双栏（最近项目 + 动态提示）。
    通过 ``GotoScreen`` 消息把跳转意图发给 App；通过 ``OpenHistory`` 消息把
    打开历史项目的意图发给 App（统一在 App 处理项目状态更新与状态栏刷新）。
    """

    screen_name = "dashboard"

    BINDINGS = [
        Binding("escape", "app.bell", "返回", show=False),
        Binding("1", "select_entry(0)", "校验", show=False),
        Binding("2", "select_entry(1)", "Provider", show=False),
        Binding("3", "select_entry(2)", "配置", show=False),
        Binding("4", "select_entry(3)", "对话", show=False),
        Binding("5", "select_entry(4)", "生成", show=False),
        Binding("6", "select_entry(5)", "迁移", show=False),
    ]

    def compose_content(self) -> ComposeResult:
        """组装首页看板。"""
        with Vertical(id="dashboard-root"):
            # 顶部：左侧标题/副标题，右侧状态横幅
            with Horizontal(id="dashboard-header", classes="entrance-item"):
                with Vertical(id="dashboard-title-block"):
                    yield Label(
                        f"[bold $primary]PRECIS[/bold $primary]  [dim]{_APP_VERSION}[/dim]",
                        id="dashboard-title",
                        markup=True,
                    )
                    yield Label("终端数据校验平台", id="dashboard-subtitle")
                with Vertical(id="status-banner"):
                    yield Label("初始化中…", id="banner-content", markup=True)

            # 功能入口卡片网格（2 行 × 3 列）
            with Vertical(id="feature-cards", classes="entrance-item"):
                with Horizontal(classes="card-row"):
                    for idx, entry in enumerate(_QUICK_ENTRIES[:_GRID_COLUMNS]):
                        yield DashboardCard(entry, idx)
                with Horizontal(classes="card-row"):
                    for idx, entry in enumerate(_QUICK_ENTRIES[_GRID_COLUMNS:]):
                        yield DashboardCard(entry, idx + _GRID_COLUMNS)

            # 底部：最近项目 + 动态提示
            with Horizontal(id="dashboard-bottom"):
                with Vertical(id="recent-section", classes="entrance-item"):
                    yield Label("最近项目", classes="panel-header")
                    yield OptionList(id="recent-projects")
                with Vertical(id="tips-section", classes="entrance-item"):
                    yield Label("操作提示", classes="panel-header")
                    yield Label(_DEFAULT_TIPS, id="tips-text", markup=True)

    def on_mount(self) -> None:
        """挂载时聚焦首个卡片、填充最近项目，并刷新横幅与提示。

        ``super().on_mount()`` 触发 BaseScreen 的入场动效（本类未重写
        ``_run_entrance_animation``，不会重复播放）。
        """
        super().on_mount()
        cards = list(self.query(DashboardCard))
        if cards:
            cards[0].focus()
            self._refresh_tips(0)
        self._reload_history()
        self._refresh_overview()

    def on_screen_resume(self) -> None:
        """Dashboard 成为活动屏时启用当前选中的背景特效。"""
        if hasattr(self.app, "set_fx_background"):
            background = getattr(self.app, "_precis_background", "starfield")
            self.app.set_fx_background(background)

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
            history_list.add_option(Option(f"▣ {label}\n[dim]{path}[/dim]", id=path))

    def _refresh_overview(self) -> None:
        """刷新状态横幅文案与项目统计速览。"""
        banner = self.query_one("#banner-content", Label)
        banner_container = self.query_one("#status-banner")
        path = getattr(self.app, "project_path", None)
        config = getattr(self.app, "project_config", None)
        if not path:
            banner.update("[yellow]○ 未打开项目[/yellow]\n[dim]按 Ctrl+O 选择项目，或从下方最近项目打开[/dim]")
            banner_container.set_class(False, "project-open")
            banner_container.set_class(True, "project-closed")
            return
        try:
            label = project_ops.resolve_project_label(path)
        except Exception:  # noqa: BLE001
            label = path
        stats = self._format_project_stats(config)
        banner.update(f"[green]●[/green] [bold]{label}[/bold]\n[dim]{path}[/dim]\n{stats}")
        banner_container.set_class(True, "project-open")
        banner_container.set_class(False, "project-closed")

    @staticmethod
    def _format_project_stats(config: dict | None) -> str:
        """将项目配置中的关键计数格式化为状态横幅统计行。"""
        if not config:
            return ""
        keys = [
            ("schemas", "Schema"),
            ("constraints", "约束"),
            ("data_sources", "数据源"),
            ("regex_nodes", "正则"),
            ("transforms", "转换"),
        ]
        parts: list[str] = []
        for key, label in keys:
            value = config.get(key)
            if isinstance(value, list):
                count = len(value)
                if count > 0:
                    parts.append(f"[bold]{count}[/bold] [dim]{label}[/dim]")
        if not parts:
            return ""
        return " · ".join(parts)

    def _refresh_tips(self, index: int | None = None) -> None:
        """根据当前高亮的功能入口刷新右侧提示。"""
        tips = self.query_one("#tips-text", Label)
        if index is None:
            focused = self.focused
            if isinstance(focused, DashboardCard):
                index = focused.entry_index
            else:
                tips.update(_DEFAULT_TIPS)
                return
        if not (0 <= index < len(_QUICK_ENTRIES)):
            tips.update(_DEFAULT_TIPS)
            return
        name, key, icon, label, desc = _QUICK_ENTRIES[index]
        tips.update(f"[bold]{icon} {label}[/bold]\n\n{desc}\n\n[dim]快捷键[/dim]  [bold]{key}[/bold] / Enter")

    def action_select_entry(self, index: str) -> None:
        """数字快捷键选中功能入口并跳转。"""
        try:
            idx = int(index)
        except ValueError:
            return
        if not (0 <= idx < len(_QUICK_ENTRIES)):
            return
        cards = list(self.query(DashboardCard))
        if 0 <= idx < len(cards):
            cards[idx].focus()
            self._refresh_tips(idx)
        self.post_message(self.GotoScreen(name=_QUICK_ENTRIES[idx][0]))

    def on_key(self, event) -> None:
        """方向键在卡片网格中移动焦点。"""
        focused = self.focused
        if not isinstance(focused, DashboardCard):
            return
        idx = focused.entry_index
        new_idx: int | None = None
        if event.key == "left":
            if idx % _GRID_COLUMNS != 0:
                new_idx = idx - 1
        elif event.key == "right":
            if idx % _GRID_COLUMNS != _GRID_COLUMNS - 1:
                new_idx = idx + 1
        elif event.key == "up":
            if idx >= _GRID_COLUMNS:
                new_idx = idx - _GRID_COLUMNS
        elif event.key == "down":
            if idx < len(_QUICK_ENTRIES) - _GRID_COLUMNS:
                new_idx = idx + _GRID_COLUMNS
        if new_idx is not None and 0 <= new_idx < len(_QUICK_ENTRIES):
            cards = list(self.query(DashboardCard))
            cards[new_idx].focus()
            self._refresh_tips(new_idx)
            event.stop()

    @on(OptionList.OptionSelected, "#recent-projects")
    def _on_history_selected(self, event: OptionList.OptionSelected) -> None:
        """最近项目被选中：发 OpenHistory 消息让 App 打开并刷新状态。"""
        event.stop()
        path = event.option.id or ""
        if path == "__empty__":
            return
        self.post_message(self.OpenHistory(path=path))

    class GotoScreen(Message):
        """请求 App 跳转到指定功能屏。"""

        def __init__(self, name: str) -> None:
            super().__init__()
            self.name: str = name
            """目标屏注册名。"""

    class OpenHistory(Message):
        """请求 App 打开历史项目并更新全局状态。"""

        def __init__(self, path: str) -> None:
            super().__init__()
            self.path: str = path
            """待打开项目的绝对路径。"""

    class RefreshTips(Message):
        """通知 Screen 刷新右侧提示。"""

        def __init__(self, index: int) -> None:
            super().__init__()
            self.index: int = index

    def on_dashboard_screen_refresh_tips(self, event: RefreshTips) -> None:
        """卡片焦点变化时刷新提示。"""
        event.stop()
        self._refresh_tips(event.index)

    def refresh_overview(self) -> None:
        """供 App 在项目状态变化后调用，刷新横幅与最近项目列表。"""
        self._reload_history()
        self._refresh_overview()
        # 项目打开后聚焦第一个卡片，保持提示同步
        cards = list(self.query(DashboardCard))
        if cards and isinstance(self.focused, DashboardCard):
            self._refresh_tips(self.focused.entry_index)
        else:
            self._refresh_tips()


__all__ = ["DashboardScreen"]
