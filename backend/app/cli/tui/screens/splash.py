"""Precis TUI 启动画面（Splash Screen）。

短暂的全屏启动动画：大 ASCII logo + 扫光点亮 + 版本标语，约 1.5 秒后自动进入 Dashboard。
给用户一个有冲击力的"开机第一印象"，对标现代 CLI 工具的启动序列。
"""

from __future__ import annotations

import importlib.metadata
from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import Label

try:
    _APP_VERSION = importlib.metadata.version("precis")
except Exception:  # noqa: BLE001
    _APP_VERSION = "0.1.0"

# 大号 ASCII art "PRECIS"（7 行，约 31 列宽，block 字符）
_LOGO_ART = r"""
██████╗ ██████╗  ██████╗████████╗██████╗  ██████╗ ███╗   ███╗███████╗██╗  ██╗
██╔══██╗██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗████╗ ████║██╔════╝╚██╗██╔╝
██████╔╝██████╔╝██╔███╗     ██║   ██████╔╝██║   ██║██╔████╔██║█████╗   ╚███╔╝
██╔═══╝ ██╔══██╗██║██╔╗    ██║   ██╔══██╗██║   ██║██║╚██╔╝██║██╔══╝   ██╔██╗
██║     ██║  ██║╚██████╔╝   ██║   ██║  ██║╚██████╔╝██║ ╚═╝ ██║███████╗╚███╔██╗
╚═╝     ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝ ╚══╝╚═╝
"""

_TAGLINE = "Local Data Validation · 本地数据校验工具"

# 动画帧数与间隔（总时长 ≈ frames × interval）
_ANIM_FRAMES = 14
_ANIM_INTERVAL = 0.08  # 约 1.1 秒
_HOLD_TIME = 0.4  # 点亮完成后再停留 0.4 秒

# 扫光调色板：从暗到亮的渐变色（随主题 primary 色系）
_SCAN_COLORS = ["#4c566a", "#5e81ac", "#81a1c1", "#88c0d0", "#7aa2f7"]


def _render_logo_frame(step: int, total: int, primary: str = "#7aa2f7") -> str:
    """渲染第 step 帧的 logo 文本（逐行扫光点亮效果）。

    Args:
        step: 当前帧序号（0..total）。
        total: 总帧数。
        primary: 点亮完成后的主色。

    Returns:
        可用于 Label.update 的 Rich markup 字符串。
    """
    if step >= total:
        # 全部点亮
        lines = _LOGO_ART.strip("\n").split("\n")
        return "\n".join(f"[bold {primary}]{line}[/]" for line in lines)

    # 按进度逐行点亮（从上到下）
    progress = step / total
    total_lines = 6
    lit_lines = int(progress * total_lines)
    lines = _LOGO_ART.strip("\n").split("\n")
    rendered: list[str] = []
    for idx, line in enumerate(lines):
        if idx < lit_lines:
            # 已点亮行：用当前帧对应的渐变色
            color_idx = min(int(progress * len(_SCAN_COLORS)), len(_SCAN_COLORS) - 1)
            color = _SCAN_COLORS[color_idx]
            rendered.append(f"[bold {color}]{line}[/]")
        else:
            # 未点亮行：暗灰
            rendered.append(f"[dim #3b4252]{line}[/]")
    return "\n".join(rendered)


class SplashScreen(Screen):
    """启动画面：全屏 logo 扫光动画，约 1.5 秒后自动消失。

    用户可按任意键跳过动画直接进入。
    """

    CSS = """
    SplashScreen {
        align: center middle;
        background: $surface;
    }
    #splash-container {
        align: center middle;
        text-align: center;
        width: auto;
        height: auto;
    }
    #splash-logo {
        text-align: center;
        margin: 0 0 1 0;
    }
    #splash-tagline {
        text-align: center;
        color: $text-muted;
        text-style: italic;
    }
    #splash-version {
        text-align: center;
        color: $primary;
        text-style: bold;
        margin-top: 0;
    }
    #splash-hint {
        text-align: center;
        color: $text-disabled;
        margin-top: 2;
    }
    """

    BINDINGS = [
        Binding("escape,space,enter", "skip", "", show=False),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._step = 0
        self._timer: Any = None
        self._hold_timer: Any = None
        self._done = False

    def compose(self) -> ComposeResult:
        with Vertical(id="splash-container"):
            yield Label(self._render_logo(), id="splash-logo", markup=True)
            yield Label(f"v{_APP_VERSION}", id="splash-version")
            yield Label(_TAGLINE, id="splash-tagline")
            yield Label("按任意键跳过", id="splash-hint")

    def _render_logo(self) -> str:
        """渲染当前帧的 logo。"""
        return _render_logo_frame(self._step, _ANIM_FRAMES)

    def on_mount(self) -> None:
        """启动扫光动画定时器。"""
        self._timer = self.set_interval(_ANIM_INTERVAL, self._tick)

    def _tick(self) -> None:
        """每帧推进扫光进度。"""
        if self._done:
            return
        self._step += 1
        try:
            self.query_one("#splash-logo", Label).update(self._render_logo())
        except Exception:  # noqa: BLE001
            pass
        if self._step >= _ANIM_FRAMES:
            # 动画完成，停止定时器，延时后自动切走
            if self._timer:
                self._timer.stop()
                self._timer = None
            self._hold_timer = self.set_timer(_HOLD_TIME, self._finish)

    def _finish(self) -> None:
        """结束启动画面，切换到 Dashboard。"""
        if self._done:
            return
        self._done = True
        if self._timer:
            self._timer.stop()
        if self._hold_timer:
            self._hold_timer.stop()
        app = self.app
        if hasattr(app, "_on_splash_done"):
            app._on_splash_done()  # type: ignore[attr-defined]

    def action_skip(self) -> None:
        """按任意键跳过动画。"""
        self._finish()


__all__ = ["SplashScreen"]
