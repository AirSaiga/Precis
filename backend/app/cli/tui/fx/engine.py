"""EffectEngine：统一管理所有特效的更新和渲染。"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from textual.widgets import Static

from app.cli.tui.fx.canvas import CanvasWidget
from app.cli.tui.fx.confetti import ConfettiEffect
from app.cli.tui.fx.glow import GlowEffect
from app.cli.tui.fx.particle import Effect
from app.cli.tui.fx.starfield import StarfieldEffect

if TYPE_CHECKING:
    from textual.app import App


class EffectEngine:
    """特效引擎。

    持有 CanvasWidget，通过定时器驱动所有 Effect 更新和渲染。
    提供便捷方法触发常用特效（星空、庆祝、光晕）。
    """

    def __init__(self, app: App, canvas: CanvasWidget, fps: float = 20.0) -> None:
        """
        Args:
            app: Textual App 实例，用于设置定时器。
            canvas: 特效渲染目标画布。
            fps: 特效刷新帧率。
        """
        self.app = app
        self.canvas = canvas
        self.fps = fps
        self._interval = 1.0 / fps
        self.effects: list[Effect] = []
        self._timer: Any | None = None
        self._last_time = time.monotonic()
        self._paused = False

    def start(self) -> None:
        """启动特效引擎定时器。"""
        if self._timer is not None:
            return
        self._last_time = time.monotonic()
        self._timer = self.app.set_interval(self._interval, self._tick)

    def stop(self) -> None:
        """停止特效引擎定时器。"""
        if self._timer is not None:
            self._timer.stop()
            self._timer = None

    def pause(self) -> None:
        """暂停更新（不停止定时器，仅跳过逻辑）。"""
        self._paused = True

    def resume(self) -> None:
        """恢复更新。"""
        self._paused = False
        self._last_time = time.monotonic()

    def add(self, effect: Effect) -> None:
        """添加一个特效。"""
        self.effects.append(effect)

    def clear(self) -> None:
        """清除所有特效。"""
        self.effects.clear()
        self.canvas.clear()
        self.canvas.refresh()

    def trigger(self, name: str, **kwargs: Any) -> None:
        """触发一个命名特效。

        Args:
            name: 特效名，支持 "starfield", "confetti", "glow"。
            **kwargs: 特效构造参数。
        """
        if name == "starfield":
            self.add(StarfieldEffect(**kwargs))
        elif name == "confetti":
            self.add(ConfettiEffect(**kwargs))
        elif name == "glow":
            target = kwargs.get("target")
            if isinstance(target, Static):
                self.add(GlowEffect(target, **{k: v for k, v in kwargs.items() if k != "target"}))

    def set_background(self, effect: Effect | None = None) -> None:
        """设置一个常驻背景特效。

        会清除已有的背景类特效（Starfield），保留一次性特效（Confetti）。
        """
        self.effects = [e for e in self.effects if not isinstance(e, StarfieldEffect)]
        if effect is not None:
            self.effects.insert(0, effect)

    def _tick(self) -> None:
        """定时器回调：更新并渲染所有特效。"""
        if self._paused:
            return
        now = time.monotonic()
        dt = now - self._last_time
        self._last_time = now
        # 限制最大 dt，避免切换窗口后跳变过大
        dt = min(dt, 0.1)

        width = self.canvas.canvas_width
        height = self.canvas.canvas_height
        if width <= 0 or height <= 0:
            return

        self.canvas.clear()
        for effect in self.effects:
            effect.update(dt, width, height)
            effect.render(self.canvas)
        # 清理已结束特效
        self.effects = [e for e in self.effects if e.is_alive]
        self.canvas.refresh()
