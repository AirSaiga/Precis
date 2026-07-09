"""持久侧边栏导航组件。

``Sidebar`` 渲染在功能屏左侧，提供所有已注册屏的一键跳转入口，
并在当前活动项上播放扫描线动效。窗口宽度小于阈值时自动折叠为图标模式。
"""

from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.message import Message
from textual.reactive import reactive
from textual.timer import Timer
from textual.widget import Widget
from textual.widgets import Static

from app.cli.tui.protocols import SCREEN_REGISTRY

# 屏的显示文案与折叠图标（未列出的屏使用 name.title() / 首字母大写）
_SCREEN_LABELS: dict[str, str] = {
    "dashboard": "Dashboard",
    "validation": "校验",
    "provider": "Provider",
    "config": "配置",
    "chat": "对话",
    "generate": "生成",
    "migrate": "迁移",
}

_SCREEN_ICONS: dict[str, str] = {
    "dashboard": "D",
    "validation": "V",
    "provider": "P",
    "config": "C",
    "chat": "A",
    "generate": "G",
    "migrate": "M",
}

# 窗口宽度小于此值时侧边栏折叠
_COLLAPSE_WIDTH = 100


class SidebarNavigate(Message):
    """Sidebar 导航请求消息。

    Attributes:
        name: 目标屏在 ``SCREEN_REGISTRY`` 中的注册名。
    """

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__()


class SidebarItem(Vertical):
    """单个导航项。

    包含文案与扫描线 Static；点击时向上冒泡 ``SidebarNavigate`` 消息。
    """

    def __init__(
        self,
        screen_name: str,
        *,
        label: str,
        icon: str,
        collapsed: bool,
        active: bool,
    ) -> None:
        classes = "sidebar-item"
        if active:
            classes += " active"
        super().__init__(classes=classes)
        self.screen_name = screen_name
        self._label = label
        self._icon = icon
        self._collapsed = collapsed

    def compose(self) -> ComposeResult:  # noqa: D102
        text = self._icon if self._collapsed else self._label
        yield Static(text, classes="sidebar-item-label")
        yield Static("─" * 14, classes="sidebar-scanline")

    def on_click(self) -> None:
        """点击导航项时触发跳转，并播放点击脉冲动效。"""
        self.add_class("clicked")
        self.set_timer(0.12, lambda: self.remove_class("clicked"))
        # 直接调 app._goto_screen，不依赖消息冒泡（消息冒泡在 Sidebar→BaseScreen
        # 之间可能被 Textual 的事件循环吞掉，导致点击无效）
        try:
            app = self.app
            if hasattr(app, "_goto_screen"):
                app._goto_screen(self.screen_name)
        except Exception:  # noqa: BLE001 - 卸载中点击可能失效，忽略避免闪退
            pass


class Sidebar(Widget):
    """持久侧边栏。

    从 ``SCREEN_REGISTRY`` 动态生成导航项；接收 ``current_screen`` 属性以高亮
    当前屏，并在活动项上循环播放扫描线透明度动效。
    """

    Navigate = SidebarNavigate

    DEFAULT_CSS = """
    Sidebar {
        width: 22;
        height: 100%;
        background: $panel;
        border-right: solid $border;
        layout: vertical;
        padding: 1 0 0 0;
    }
    Sidebar.sidebar-collapsed {
        width: 5;
    }

    #sidebar-logo {
        height: auto;
        padding: 0 1 1 1;
        color: $primary;
        text-style: bold;
        content-align: center middle;
    }
    Sidebar.sidebar-collapsed #sidebar-logo {
        padding: 0;
        content-align: center middle;
    }

    .sidebar-item {
        height: auto;
        margin: 0 1 0 0;
        padding: 0 1;
        color: $foreground;
        background: transparent;
        border-left: thick transparent;
        offset: 0 0;
        transition: offset 80ms, background 120ms, color 120ms, border-left-color 120ms, tint 120ms;
    }
    .sidebar-item:hover {
        background: $boost;
        offset: 1 0;
    }
    .sidebar-item:focus {
        background: $surface;
        border-left: thick $primary;
        offset: 2 0;
    }
    .sidebar-item.active {
        background: $surface;
        color: $primary;
        text-style: bold;
        border-left: thick $primary;
        tint: $primary 5%;
    }
    .sidebar-item.clicked {
        offset: 3 0;
        tint: $primary 25%;
    }
    .sidebar-item.active:hover {
        background: $panel;
    }
    Sidebar.sidebar-collapsed .sidebar-item {
        padding: 0;
        margin: 0;
        height: 3;
    }
    Sidebar.sidebar-collapsed .sidebar-item-label {
        content-align: center middle;
    }

    .sidebar-scanline {
        height: 1;
        color: $primary 60%;
        display: none;
        transition: color 120ms;
    }
    .sidebar-item.active .sidebar-scanline {
        display: block;
    }
    .sidebar-scanline.dim {
        color: $primary 15%;
    }
    .sidebar-scanline.bright {
        color: $primary 85%;
    }
    Sidebar.sidebar-collapsed .sidebar-scanline {
        display: none;
    }
    """

    current_screen: reactive[str] = reactive("")
    collapsed: reactive[bool] = reactive(False)

    def __init__(
        self,
        current_screen: str = "",
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
        disabled: bool = False,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes, disabled=disabled)
        self._scanline_timer: Timer | None = None
        self._auto_collapsed = False
        self.current_screen = current_screen

    def compose(self) -> ComposeResult:  # noqa: D102
        yield Static(self._logo_text(), id="sidebar-logo")
        for name in SCREEN_REGISTRY:
            yield SidebarItem(
                screen_name=name,
                label=_SCREEN_LABELS.get(name, name.title()),
                icon=_SCREEN_ICONS.get(name, name[0].upper()),
                collapsed=self._is_collapsed(),
                active=name == self.current_screen,
            )

    def _logo_text(self) -> str:
        """根据折叠状态返回 logo 文本。"""
        return "◈" if self._is_collapsed() else "◈ PRECIS"

    def _is_collapsed(self) -> bool:
        """当前是否应处于折叠状态。"""
        return self.collapsed

    def toggle_collapsed(self) -> None:
        """手动切换折叠状态（覆盖窗口宽度的自动判定）。"""
        self.collapsed = not self.collapsed
        self._auto_collapsed = False

    def on_mount(self) -> None:
        """挂载后同步折叠状态并启动扫描线。"""
        self._sync_auto_collapsed()
        self._update_collapsed_state()
        self._restart_scanline()

    def watch_current_screen(self, old_name: str, new_name: str) -> None:
        """当前屏变化时更新高亮。"""
        for item in self.query(SidebarItem):
            item.set_class(item.screen_name == new_name, "active")
        self._restart_scanline()

    def watch_collapsed(self, old_value: bool, new_value: bool) -> None:
        """折叠状态变化时刷新样式与文案。"""
        if old_value != new_value:
            self._update_collapsed_state()

    def on_resize(self) -> None:
        """窗口尺寸变化时同步折叠状态。"""
        self._sync_auto_collapsed()

    def _sync_auto_collapsed(self) -> None:
        """根据应用窗口宽度自动设置折叠状态（侧边栏自身宽度恒为 22/5）。"""
        app_width = self.app.size.width if self.app else 0
        auto = app_width > 0 and app_width < _COLLAPSE_WIDTH
        if auto != self._auto_collapsed:
            self._auto_collapsed = auto
            self.collapsed = auto

    def _update_collapsed_state(self) -> None:
        """根据当前折叠状态切换样式与文案。"""
        collapsed = self._is_collapsed()
        self.set_class(collapsed, "sidebar-collapsed")
        self.query_one("#sidebar-logo", Static).update(self._logo_text())
        for item in self.query(SidebarItem):
            label = _SCREEN_LABELS.get(item.screen_name, item.screen_name.title())
            icon = _SCREEN_ICONS.get(item.screen_name, item.screen_name[0].upper())
            item.query_one(".sidebar-item-label", Static).update(icon if collapsed else label)

    def on_sidebar_navigate(self, event: SidebarNavigate) -> None:
        """捕获导航消息并继续向上冒泡给父级 Screen/App。"""
        # 让消息继续冒泡，BaseScreen 的 on_sidebar_navigate 会处理
        pass

    def _restart_scanline(self) -> None:
        """为当前活动项启动/重启扫描线定时器。"""
        if self._scanline_timer is not None:
            self._scanline_timer.stop()
            self._scanline_timer = None

        active = self.query(".sidebar-item.active")
        if not active:
            return

        try:
            scanline = active.first().query_one(".sidebar-scanline", Static)
        except Exception:  # noqa: BLE001 - 活动项可能不含扫描线节点
            return
        scanline.remove_class("dim", "bright")
        self._scanline_timer = self.set_interval(0.22, self._toggle_scanline)

    def _toggle_scanline(self) -> None:
        """定时切换扫描线透明度，形成呼吸效果。"""
        active = self.query(".sidebar-item.active")
        if not active:
            if self._scanline_timer is not None:
                self._scanline_timer.stop()
                self._scanline_timer = None
            return
        try:
            scanline = active.first().query_one(".sidebar-scanline", Static)
        except Exception:  # noqa: BLE001 - 扫描线节点可能已失效
            if self._scanline_timer is not None:
                self._scanline_timer.stop()
                self._scanline_timer = None
            return
        # 三态循环：normal → dim → bright → normal
        if scanline.has_class("dim"):
            scanline.remove_class("dim")
            scanline.add_class("bright")
        elif scanline.has_class("bright"):
            scanline.remove_class("bright")
        else:
            scanline.add_class("dim")
