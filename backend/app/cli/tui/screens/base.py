"""TUI 屏基类。

``BaseScreen`` 为所有功能屏提供统一的持久侧边栏与内容容器布局，
并负责在屏切换时清理背景特效。子类只需实现 ``compose_content()``。
"""

from __future__ import annotations

from typing import Any, ClassVar

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import Screen
from textual.widget import Widget
from textual.widgets._tooltip import Tooltip

from app.cli.tui.fx.animation import animate_opacity
from app.cli.tui.fx.focus_glow import FocusGlow
from app.cli.tui.widgets.sidebar import Sidebar
from app.cli.tui.widgets.toast import AnimatedToastRack


class BaseScreen(Screen):
    """带持久侧边栏的功能屏基类。

    额外提供：
    - 全局焦点光晕（FocusGlow）
    - 内容区错开入场动效

    Attributes:
        screen_name: 当前屏在 ``SCREEN_REGISTRY`` 中的注册名，
            子类必须覆盖，用于侧边栏高亮与跳转。
        enable_entrance: 是否启用挂载后的内容入场动效。
        ENTRANCE_DELAY: 相邻元素入场的时间间隔（秒）。
        ENTRANCE_DURATION: 单个元素入场时长（秒）。
    """

    screen_name: ClassVar[str] = ""
    enable_entrance: ClassVar[bool] = True
    ENTRANCE_DELAY: ClassVar[float] = 0.06
    ENTRANCE_DURATION: ClassVar[float] = 0.22

    DEFAULT_CSS = """
    BaseScreen {
        layout: vertical;
        background: transparent;
        layers: fx background foreground;
    }
    #base-screen-root {
        width: 100%;
        height: 100%;
        background: transparent;
    }
    #content-area {
        width: 1fr;
        height: 100%;
        background: transparent;
        layout: vertical;
        padding: 0 1;
    }
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._focus_glow = FocusGlow(self)
        self._entrance_tweens: list[Any] = []

    def compose(self) -> ComposeResult:
        """组装侧边栏 + 内容区；子类在 ``compose_content()`` 中填充内容。"""
        with Horizontal(id="base-screen-root"):
            yield Sidebar(current_screen=self.screen_name, id="sidebar")
            with Vertical(id="content-area"):
                yield from self.compose_content()

    def compose_content(self) -> ComposeResult:
        """子类覆盖此方法提供屏内容。

        Yields:
            属于本屏的 Textual Widget 实例。
        """
        yield from ()

    def on_mount(self) -> None:
        """挂载后启动焦点光晕与入场动效。"""
        if self.enable_entrance:
            self._run_entrance_animation()

    def on_unmount(self) -> None:
        """卸载时清理焦点光晕与未完成入场动画。"""
        self._focus_glow.stop()
        for tween in self._entrance_tweens:
            try:
                tween.stop()
            except Exception:  # noqa: BLE001
                pass
        self._entrance_tweens.clear()

    def on_screen_resume(self) -> None:
        """恢复时清除动态背景特效，避免非 Dashboard 屏出现星空/极光。"""
        app = self.app
        if hasattr(app, "set_fx_background"):
            app.set_fx_background(None)

    def on_sidebar_navigate(self, event: Sidebar.Navigate) -> None:
        """处理侧边栏导航请求。"""
        event.stop()
        app = self.app
        if hasattr(app, "_goto_screen"):
            app._goto_screen(event.name)

    def on_descendant_focus(self, event: Any) -> None:
        """descendant 获得焦点时触发焦点光晕。"""
        try:
            self._focus_glow.on_focus(event.control)
        except Exception:  # noqa: BLE001 - widget 失效时不应导致闪退
            pass

    def on_descendant_blur(self, event: Any) -> None:
        """descendant 失去焦点时清理焦点光晕。"""
        try:
            self._focus_glow.on_blur(event.control)
        except Exception:  # noqa: BLE001 - widget 失效时不应导致闪退
            pass

    def _extend_compose(self, widgets: list[Widget]) -> None:
        """注入增强版 ToastRack，保留 Textual 原生 Tooltip。

        Textual 默认会在每个 Screen 的 ``_extend_compose`` 中插入
        ``ToastRack(id='textual-toastrack')``；这里替换为 ``AnimatedToastRack``，
        使 ``App.notify`` 弹出带滑入/抖动动效的 Toast。
        """
        if not self.app._disable_tooltips:
            widgets.insert(0, Tooltip(id="textual-tooltip"))
        if not self.app._disable_notifications:
            widgets.insert(0, AnimatedToastRack(id="textual-toastrack"))

    def toggle_focus_glow(self) -> bool:
        """切换当前屏焦点光晕开关，返回新的启用状态。"""
        return self._focus_glow.toggle()

    def set_focus_glow_enabled(self, enabled: bool) -> None:
        """设置当前屏焦点光晕开关状态。"""
        self._focus_glow.set_enabled(enabled)

    def _run_entrance_animation(self) -> None:
        """执行内容区错开入场动效。

        优先对 ``.entrance-item`` 元素做 stagger；若不存在，则对
        ``#content-area`` 的直接子元素做整体淡入。
        """
        try:
            content = self.query_one("#content-area", Vertical)
        except Exception:  # noqa: BLE001
            return

        items = list(content.query(".entrance-item"))
        if not items:
            items = list(content.children)

        # 过滤掉不可见的容器或装饰性容器
        items = [w for w in items if w.display]
        if not items:
            return

        for idx, widget in enumerate(items):
            widget.styles.opacity = 0.0
            # delay 最小 0.01：set_timer(0, ...) 在某些场景会触发 ZeroDivisionError
            delay = max(0.01, idx * self.ENTRANCE_DELAY)
            self.set_timer(
                delay,
                lambda w=widget: self._entrance_tweens.append(
                    animate_opacity(w, 0.0, 1.0, duration=self.ENTRANCE_DURATION)
                ),
            )
