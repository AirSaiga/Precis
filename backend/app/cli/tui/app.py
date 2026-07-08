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
from textual.widgets import Footer, Header

# 关键：import 所有 screen 模块以触发各自的 @register_screen 装饰器，
# 使 SCREEN_REGISTRY 在 App 启动前即包含全部 7 个屏。
# 顺序无要求，但保持稳定以便阅读。
from app.cli.shared_services import project_ops
from app.cli.tui.fx import CanvasWidget, EffectEngine
from app.cli.tui.protocols import SCREEN_REGISTRY
from app.cli.tui.screens import chat, config, generate, provider, validation  # noqa: F401
from app.cli.tui.screens.dashboard import DashboardScreen
from app.cli.tui.screens.splash import SplashScreen

# 主题系统：基于 Textual 原生 Theme 对象（非 CSS 文件），运行时即时切换。
# 主题定义见 themes.py，注册后用 app.theme = "name" 切换，所有内置 token 自动跟随。
from app.cli.tui.themes import DEFAULT_THEME, THEME_ORDER, register_all_themes
from app.cli.tui.widgets.command_palette import CommandPalette
from app.cli.tui.widgets.status_bar import StatusBar


class PrecisTUIApp(App):
    """Precis 终端界面主应用。

    实现 ``ProjectState`` 协议（project_path / project_config / is_project_open），
    持有当前打开项目的全局状态，供各屏读取。

    全局快捷键：
    - Ctrl+P：命令面板（跳转各功能屏）
    - Ctrl+Q：退出 TUI
    - F1：帮助（显示当前可用快捷键，Textual 默认 Footer 已展示，这里触发 help 动作）
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
        Binding("ctrl+o", "open_project", "打开项目", show=True),
        Binding("ctrl+v", "goto:validation", "校验", show=False),
        Binding("ctrl+t", "goto:provider", "Provider", show=False),
    ]

    def __init__(self, theme: str | None = None) -> None:
        self._precis_theme = theme or os.getenv("PRECIS_TUI_THEME", DEFAULT_THEME)
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

    @property
    def is_project_open(self) -> bool:
        """是否已打开项目（project_path 非空即视为已打开）。"""
        return self.project_path is not None

    # ---- 布局 ----

    def compose(self) -> ComposeResult:
        """组装主界面：特效画布 + Header + 内容区 + StatusBar + Footer。

        各功能屏由 ``push_screen`` 推入，不在此 yield（Textual 会把推入的屏
        渲染到 ScreenSwitch 容器）。特效画布位于最底层（CSS layer: background）。
        """
        yield CanvasWidget(id="fx-canvas")
        yield Header()
        # 实际屏内容由 push_screen 提供，这里不 yield Screen
        yield StatusBar(id="status-bar")
        yield Footer()

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
        """F1：显示帮助通知（当前可用快捷键概览）。

        详细快捷键已在底部 Footer 展示；这里补充一条说明性通知，告知命令面板用法。
        """
        self.notify(
            "Ctrl+P 命令面板 · F2 切换主题 · Ctrl+O 打开项目 · Ctrl+Q 退出",
            title="Precis TUI 帮助",
            timeout=6,
        )

    def action_goto(self, name: str) -> None:
        """通用跳转动作（供 ctrl+v / ctrl+t 等绑定调用）。"""
        self._goto_screen(name)

    # ---- 屏跳转核心 ----

    def _goto_screen(self, name: str) -> None:
        """跳转到 SCREEN_REGISTRY 中已注册的屏。

        Args:
            name: 屏注册名（如 "validation"）。未注册时通知错误，不崩溃。
        """
        cls = SCREEN_REGISTRY.get(name)
        if cls is None:
            self.notify(f"未知的屏：{name}", severity="error", timeout=5)
            return
        # 避免重复推入栈顶同名屏（如连续按 Ctrl+V）
        if self.screen is not None and type(self.screen) is cls:
            return
        try:
            self.push_screen(cls())
        except Exception as exc:  # noqa: BLE001 - 跳转失败转通知
            self.notify(f"打开屏「{name}」失败：{exc}", severity="error", timeout=8)

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
