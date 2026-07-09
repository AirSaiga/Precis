"""Precis TUI 主应用。

本模块定义 ``PrecisTUIApp``（基于 Textual 的终端界面主类）及其启动入口 ``main``。

P6 阶段完善内容（在 P0a 骨架之上）：
1. **屏注册触发**：在模块顶部 import 所有 screen 模块，使 ``@register_screen`` 装饰器
   执行，从而 ``SCREEN_REGISTRY`` 在 App 启动前即已填充全部 7 个屏。
2. **ProjectState 协议实现**：App 自身持有 ``project_path`` / ``project_config``，
   供各屏通过 ``self.app`` 读取（防御性 getattr 在各屏内已处理）。
3. **默认启动屏**：``on_mount`` 推入 Dashboard 作为首页。
4. **命令面板**（Ctrl+P）：模态屏列出全部注册屏，选中跳转。
5. **状态栏**：底部 ``StatusBar`` 显示当前项目 + Provider，项目切换时刷新。
6. **全局错误处理**：重写 ``handle_exception``，捕获未处理异常转为通知，不泄漏 stderr。

CLI 与 TUI 共享同一套核心业务逻辑（app.shared.* 与 shared_services.*），仅交互层不同。
本入口不影响现有 precis/precis-start 命令。
"""

from __future__ import annotations

import os
from typing import Any

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.css.query import NoMatches
from textual.widgets import Header
from textual.widgets._toast import ToastRack

# 关键：import 所有 screen 模块以触发各自的 @register_screen 装饰器，
# 使 SCREEN_REGISTRY 在 App 启动前即包含全部 7 个屏。
# 顺序无要求，但保持稳定以便阅读。
from app.cli.shared_services import project_ops
from app.cli.tui.fx import CanvasWidget, EffectEngine
from app.cli.tui.fx.transition import ScreenTransition
from app.cli.tui.protocols import SCREEN_ORDER, SCREEN_REGISTRY
from app.cli.tui.screens import chat, config, generate, provider, validation  # noqa: F401
from app.cli.tui.screens.dashboard import DashboardScreen
from app.cli.tui.screens.splash import SplashScreen

# 主题系统：基于 Textual 原生 Theme 对象（非 CSS 文件），运行时即时切换。
# 主题定义见 themes.py，注册后用 app.theme = "name" 切换，所有内置 token 自动跟随。
from app.cli.tui.themes import DEFAULT_THEME, THEME_ORDER, register_all_themes
from app.cli.tui.widgets.command_palette import CommandPalette
from app.cli.tui.widgets.sidebar import Sidebar
from app.cli.tui.widgets.status_bar import StatusBar


class PrecisTUIApp(App):
    """Precis 终端界面主应用。

    实现 ``ProjectState`` 协议（project_path / project_config / is_project_open），
    持有当前打开项目的全局状态，供各屏读取。

    全局快捷键：
    - Ctrl+P：命令面板（跳转各功能屏）
    - Ctrl+Q：退出 TUI
    - F1：帮助（显示当前可用快捷键）
    - Ctrl+O：打开项目（弹出命令面板聚焦最近项目，或直接跳 validation 屏用历史列表）
    - Ctrl+V：跳转校验屏
    - Ctrl+T：跳转 Provider 屏
    """

    # 全局布局样式（app.tcss 用内置 design token，随 Theme 自动变色）
    CSS_PATH = "styles/app.tcss"

    TITLE = "Precis"
    SUB_TITLE = "终端界面"

    BINDINGS = [
        Binding("ctrl+p", "command_palette", "命令面板", show=True),
        Binding("ctrl+q", "quit", "退出", show=True),
        Binding("f1", "help", "帮助", show=True),
        Binding("f2", "cycle_theme", "切换主题", show=True),
        Binding("f3", "cycle_background", "切换背景", show=True),
        Binding("f4", "toggle_sidebar", "切换侧边栏", show=True),
        Binding("f5", "toggle_focus_glow", "焦点光晕", show=True),
        Binding("ctrl+o", "open_project", "打开项目", show=True),
        Binding("ctrl+v", "goto('validation')", "校验", show=False),
        Binding("ctrl+t", "goto('provider')", "Provider", show=False),
        Binding("ctrl+1", "goto('dashboard')", "Dashboard", show=False),
        Binding("ctrl+2", "goto('validation')", "校验", show=False),
        Binding("ctrl+3", "goto('provider')", "Provider", show=False),
        Binding("ctrl+4", "goto('config')", "配置", show=False),
        Binding("ctrl+5", "goto('chat')", "对话", show=False),
        Binding("ctrl+6", "goto('generate')", "生成", show=False),
        Binding("ctrl+7", "goto('migrate')", "迁移", show=False),
    ]

    def __init__(self, theme: str | None = None) -> None:
        self._precis_theme: str = theme or str(os.getenv("PRECIS_TUI_THEME", DEFAULT_THEME))
        self._precis_background: str = "starfield"
        # 屏幕顺序用于决定屏切换过渡的滑动方向（单一事实源：protocols.SCREEN_ORDER）
        self._screen_order: list[str] = list(SCREEN_ORDER)
        super().__init__()
        # ProjectState 协议字段：当前打开项目的路径与清单配置
        self.project_path: str | None = None
        self.project_config: dict[str, Any] | None = None
        # 特效引擎，在 on_mount 中初始化
        self.effect_engine: EffectEngine | None = None

    @property
    def precis_theme(self) -> str:
        """当前 Precis TUI 主题名。"""
        return self._precis_theme

    def action_cycle_theme(self) -> None:
        """F2：循环切换主题（基于 Textual 原生 Theme，即时生效）。"""
        idx = THEME_ORDER.index(self._precis_theme) if self._precis_theme in THEME_ORDER else 0
        next_name = THEME_ORDER[(idx + 1) % len(THEME_ORDER)]
        self._precis_theme = next_name
        # app.theme 是 reactive，赋值即触发重渲染（所有内置 token 自动跟随）
        self.theme = next_name
        # 同步特效调色板，让 confetti/starfield 颜色与主题一致
        from app.cli.tui.fx.particle import set_theme_palette

        set_theme_palette(next_name)
        self.notify(f"主题：{next_name}", timeout=3)

    def action_cycle_background(self) -> None:
        """F3：循环切换常驻背景特效（starfield → aurora）。"""
        current = self._precis_background
        next_name = "aurora" if current == "starfield" else "starfield"
        self._precis_background = next_name
        # 仅在 Dashboard 屏即时生效；其他屏由 on_screen_resume 接管
        if isinstance(self.screen, DashboardScreen):
            self.set_fx_background(next_name)
        self.notify(f"背景：{next_name}", timeout=3)

    @property
    def is_project_open(self) -> bool:
        """是否已打开项目（project_path 非空即视为已打开）。"""
        return self.project_path is not None

    # ---- 布局 ----

    def compose(self) -> ComposeResult:
        """组装主界面：特效画布 + Header + 内容区 + StatusBar。

        各功能屏由 ``push_screen`` 推入，不在此 yield（Textual 会把推入的屏
        渲染到 ScreenSwitch 容器）。特效画布位于最底层（CSS layer: background）。
        """
        yield CanvasWidget(id="fx-canvas")
        yield Header()
        # 实际屏内容由 push_screen 提供，这里不 yield Screen
        yield StatusBar(id="status-bar")

    def on_mount(self) -> None:
        """挂载回调：注册主题、初始化特效引擎、推入 Splash 启动画面。"""
        # 注册全部主题并设置初始主题（app.theme 是 reactive，即时生效）
        register_all_themes(self)
        self.theme = self._precis_theme
        # 同步特效调色板到初始主题
        from app.cli.tui.fx.particle import set_theme_palette

        set_theme_palette(self._precis_theme)
        canvas = self.query_one("#fx-canvas", CanvasWidget)
        self.effect_engine = EffectEngine(self, canvas)
        self.effect_engine.start()
        # 推入启动画面（动画结束后自动切到 Dashboard）
        self.push_screen(SplashScreen())

    def _on_splash_done(self) -> None:
        """Splash 动画结束后调用：切换到 Dashboard。"""
        self.pop_screen()  # 移除 SplashScreen
        self.push_screen(DashboardScreen())
        self._refresh_status_bar()

    # ---- 特效触发 ----

    def trigger_fx(self, name: str, **kwargs: Any) -> None:
        """触发一个全局特效（供各屏调用）。

        Args:
            name: 特效名，如 "confetti"。
            **kwargs: 特效参数。
        """
        if self.effect_engine is not None:
            self.effect_engine.trigger(name, **kwargs)

    def set_fx_background(self, name: str | None = "starfield", **kwargs: Any) -> None:
        """设置全局背景特效。

        Args:
            name: 背景特效名，None 表示清除背景特效。
            **kwargs: 特效参数。
        """
        if self.effect_engine is None:
            return
        if name is None:
            self.effect_engine.set_background(None)
            return
        if name == "starfield":
            from app.cli.tui.fx.starfield import StarfieldEffect

            self.effect_engine.set_background(StarfieldEffect(**kwargs))
        elif name == "aurora":
            from app.cli.tui.fx.aurora import AuroraEffect

            self.effect_engine.set_background(AuroraEffect(**kwargs))
        elif name == "confetti":
            from app.cli.tui.fx.confetti import ConfettiEffect

            self.effect_engine.set_background(ConfettiEffect(**kwargs))

    # ---- 状态栏刷新 ----

    def _refresh_status_bar(self) -> None:
        """刷新底部状态栏文案（当前项目 + Provider）。

        幂等：可安全地在每次屏切换 / 项目变化后调用。
        """
        try:
            self.query_one("#status-bar", StatusBar).refresh_state(self)
        except Exception:  # noqa: BLE001 - 状态栏刷新失败不应阻断主流程
            pass

    def _refresh_notifications(self) -> None:
        """重写 Textual 默认通知刷新，以支持 AnimatedToastRack 子类。

        原实现使用 ``screen.get_child_by_type(ToastRack)``，仅匹配 exact type；
        BaseScreen 插入的是 ``AnimatedToastRack``（ToastRack 子类），会收不到刷新。
        这里改用 ``query_one(ToastRack)``，接受子类，使 notify 消息进入增强版 rack。
        """
        try:
            screen = self.screen
        except Exception:  # noqa: BLE001
            return
        try:
            toast_rack = screen.query_one(ToastRack)
        except NoMatches:
            return
        self.call_later(toast_rack.show, self._notifications)

    # ---- 全局动作（BINDINGS 对应）----

    def action_command_palette(self) -> None:
        """Ctrl+P：唤出命令面板模态屏。

        选中某屏后回调 ``_on_palette_selected`` 执行跳转；取消则不操作。
        """

        def _on_selected(name: str | None) -> None:
            if name:
                self._goto_screen(name)

        self.push_screen(CommandPalette(), _on_selected)

    def action_open_project(self) -> None:
        """Ctrl+O：打开项目。

        当前实现：跳转到 validation 屏（其左侧有历史列表可打开最近项目）。
        未来可在此前弹一个「输入路径 / 选最近」的模态屏，待 P6 后续迭代。
        """
        self._goto_screen("validation")

    def action_help(self) -> None:
        """F1：显示帮助通知（当前可用快捷键概览）。"""
        self.notify(
            "Ctrl+P 命令面板 · F2 主题 · F3 背景 · F4 侧边栏 · F5 焦点光晕 · "
            "Ctrl+1~7 功能屏 · Ctrl+O 打开项目 · Esc 返回 Dashboard · Ctrl+Q 退出",
            title="Precis TUI 帮助",
            timeout=6,
        )

    def action_toggle_sidebar(self) -> None:
        """F4：切换当前屏侧边栏的折叠/展开状态。"""
        screen = self.screen
        if screen is None:
            return
        try:
            sidebar = screen.query_one("#sidebar", Sidebar)
        except Exception:  # noqa: BLE001 - 当前屏无侧边栏时静默忽略
            return
        sidebar.toggle_collapsed()

    def action_toggle_focus_glow(self) -> None:
        """F5：切换当前屏焦点光晕效果。"""
        screen = self.screen
        if screen is None or not hasattr(screen, "toggle_focus_glow"):
            self.notify("当前屏不支持焦点光晕", severity="warning", timeout=2)
            return
        enabled = screen.toggle_focus_glow()
        self.notify(f"焦点光晕：{'开' if enabled else '关'}", timeout=2)

    def action_goto(self, name: str) -> None:
        """通用跳转动作（供 ctrl+v / ctrl+t 等绑定调用）。"""
        self._goto_screen(name)

    # ---- 屏跳转核心 ----

    def _goto_screen(self, name: str) -> None:
        """跳转到 SCREEN_REGISTRY 中已注册的屏，带淡入淡出过渡。

        过渡进行中也可接受新的切屏请求（会先完成/跳过当前过渡再切），
        避免用户连续点击时后续点击被静默丢弃。

        Args:
            name: 屏注册名（如 "validation"）。
        """
        cls = SCREEN_REGISTRY.get(name)
        if cls is None:
            self.notify(f"未知的屏：{name}", severity="error", timeout=5)
            return
        # 避免重复推入栈顶同名屏（如连续按 Ctrl+V）
        if self.screen is not None and type(self.screen) is cls:
            return

        def _push_target() -> None:
            try:
                # 单屏活跃模型：先 pop 所有非根屏（释放旧屏 timer/widget），
                # 再 push 新屏。在遮罩黑场时执行，用户感知不到切换。
                # 这样旧屏被 unmount，其 FocusGlow/入场动效 timer 随之停止，
                # 避免切 N 次屏后 N 套 timer 泄漏。
                while len(self.screen_stack) > 1:
                    self.pop_screen()
                self.push_screen(cls())
            except Exception as exc:  # noqa: BLE001
                self.notify(f"打开屏「{name}」失败：{exc}", severity="error", timeout=8)

        # 过渡进行中时：跳过过渡动画直接切（不丢弃用户的点击）
        if getattr(self, "_transition_active", False):
            # 清理可能残留的过渡遮罩，避免 id 冲突 + 释放锁
            try:
                self.query_one("#transition-overlay").remove()
            except Exception:  # noqa: BLE001
                pass
            self._transition_active = False
            _push_target()
            return

        def _transition_done() -> None:
            self._transition_active = False

        direction = self._resolve_transition_direction(name)
        duration = getattr(self, "_transition_duration", 0.15)
        try:
            self._transition_active = True
            ScreenTransition(self, duration=duration, direction=direction).run(
                on_blackout=_push_target, on_done=_transition_done
            )
        except Exception:  # noqa: BLE001 - 过渡启动失败时回退到无过渡直跳
            self._transition_active = False
            _push_target()

    def _resolve_transition_direction(self, target_name: str) -> int:
        """根据当前屏与目标屏在侧边栏顺序中的位置决定过渡方向。

        Returns:
            1 表示目标在当前之后（前进/向右扫），-1 表示目标在之前（返回/向左扫），
            0 表示无法判断方向（使用普通淡入淡出）。
        """
        current = self.screen
        if current is None:
            return 0
        current_name: str | None = getattr(current, "screen_name", None)
        if not isinstance(current_name, str):
            return 0
        try:
            current_index = self._screen_order.index(current_name)
            target_index = self._screen_order.index(target_name)
        except ValueError:
            return 0
        if target_index > current_index:
            return 1
        if target_index < current_index:
            return -1
        return 0

    # ---- Dashboard 消息处理 ----

    def on_dashboard_screen_goto_screen(self, event: DashboardScreen.GotoScreen) -> None:
        """Dashboard 请求跳转功能屏。"""
        event.stop()
        self._goto_screen(event.name)

    def on_dashboard_screen_open_history(self, event: DashboardScreen.OpenHistory) -> None:
        """Dashboard 请求打开历史项目：执行 project_ops.open_project 并更新状态。"""
        event.stop()
        result = project_ops.open_project(event.path)
        if not result.success:
            self.notify(result.message, severity="warning", timeout=6)
            return
        # 更新全局项目状态
        self.project_path = result.project_path
        self.project_config = result.config
        # 刷新 Dashboard 概览 + 全局状态栏
        self._refresh_dashboard()
        self._refresh_status_bar()
        # 仅在 Dashboard 屏触发庆祝特效，避免后台屏放烟花
        if isinstance(self.screen, DashboardScreen):
            self.trigger_fx("confetti")
        self.notify(result.message, title="项目已打开", timeout=4)

    def _refresh_dashboard(self) -> None:
        """刷新当前 Dashboard 屏的概览与历史列表（若栈顶是 Dashboard）。"""
        if isinstance(self.screen, DashboardScreen):
            self.screen.refresh_overview()

    # ---- 全局错误处理 ----

    def handle_exception(self, error: Exception) -> None:  # type: ignore[override]
        """捕获未处理异常，转为通知而非向 stderr 泄漏 traceback。

        Textual 在事件循环内捕获异常时会调用此方法。默认实现会打印 traceback 到
        stderr 并可能崩溃 UI；重写为「通知 + 记录日志」，保证 TUI 不因单次异常退出。

        Args:
            error: 未被业务代码捕获的异常。
        """
        import logging

        logging.getLogger(__name__).exception("TUI 未处理异常", exc_info=error)
        try:
            self.notify(
                f"发生错误：{type(error).__name__}: {error}",
                severity="error",
                timeout=10,
            )
        except Exception:  # noqa: BLE001 - 通知也失败时只能放弃
            pass


def main() -> int:
    """TUI 主入口函数（对应 pyproject 的 precis-tui console_script）。

    Returns:
        退出码，0 表示正常退出。
    """
    PrecisTUIApp().run()
    return 0
