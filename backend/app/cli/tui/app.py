"""Precis TUI 主应用。

本模块定义 ``PrecisTUIApp``（基于 Textual 的终端界面主类）及其启动入口 ``main``。

P0a 阶段仅搭骨架：包含 Header/Footer 与全局快捷键（Ctrl+P 命令面板、Ctrl+Q 退出），
不装载具体功能屏。P6 阶段会遍历 ``tui.protocols.SCREEN_REGISTRY`` 装配各屏、
实现默认启动屏与全局错误处理。

CLI 与 TUI 的关系：两者共享同一套核心业务逻辑（app.shared.* 与 P0b 抽出的
app.cli.shared_services.*），仅交互层不同。本入口不影响现有 precis/precis-start 命令。
"""

from __future__ import annotations

from textual.app import App, ComposeResult
from textual.widgets import Footer, Header


class PrecisTUIApp(App):
    """Precis 终端界面主应用。

    绑定全局快捷键：
    - Ctrl+P：唤出命令面板（P6 实现，P0a 仅占位）
    - Ctrl+Q：退出 TUI
    """

    BINDINGS = [
        ("ctrl+p", "command_palette", "命令面板"),
        ("ctrl+q", "quit", "退出"),
    ]
    TITLE = "Precis"

    def compose(self) -> ComposeResult:
        """组装主界面布局。

        P0a 仅渲染 Header 与 Footer；P6 会在此装载默认屏（Dashboard）。
        """
        yield Header()
        yield Footer()

    def on_mount(self) -> None:
        """应用挂载回调。

        P0a 只展示欢迎界面（Header/Footer）；P6 会在此装载默认屏、
        读取 SCREEN_REGISTRY 并装配各功能屏的快捷键。
        """

    def action_command_palette(self) -> None:
        """命令面板动作（Ctrl+P）。

        P0a 占位实现：暂不弹出面板。P6 会实现真正的命令面板（widgets/command_palette.py）。
        """


def main() -> int:
    """TUI 主入口函数（对应 pyproject 的 precis-tui console_script）。

    Returns:
        退出码，0 表示正常退出。
    """
    PrecisTUIApp().run()
    return 0
