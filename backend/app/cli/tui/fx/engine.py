"""EffectEngine：统一管理所有特效的更新和渲染。"""

from __future__ import annotations

import random
import time
from typing import TYPE_CHECKING, Any

from textual.widgets import Static

from app.cli.tui.fx.aurora import AuroraEffect
from app.cli.tui.fx.canvas import CanvasWidget
from app.cli.tui.fx.confetti import ConfettiEffect
from app.cli.tui.fx.glow import GlowEffect
from app.cli.tui.fx.meteor import MeteorEffect
from app.cli.tui.fx.particle import BackgroundEffect, Effect
from app.cli.tui.fx.starfield import StarfieldEffect

if TYPE_CHECKING:
    from textual.app import App


class EffectEngine:
    """特效引擎。

    持有 CanvasWidget，通过定时器驱动所有 Effect 更新和渲染。
    提供便捷方法触发常用特效（星空、庆祝、光晕）。
    """

    def __init__(self, app: App, canvas: CanvasWidget, fps: float = 15.0) -> None:
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
        # 偶发流星自动触发：默认开启，约每 [min,max] 秒随机间隔一颗。
        self._meteor_enabled: bool = True
        self._meteor_min: float = 8.0
        self._meteor_max: float = 15.0
        self._meteor_countdown: float = self._roll_meteor_interval()
        # 同时存活流星数上限（避免偶发密集导致画面花哨）。
        self._meteor_cap: int = 2

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

    def set_meteor_interval(self, min_sec: float = 8.0, max_sec: float = 15.0, enabled: bool | None = None) -> None:
        """配置偶发流星的自动触发间隔。

        Args:
            min_sec: 两次流星之间的最短间隔（秒）。
            max_sec: 两次流星之间的最长间隔（秒）。
            enabled: 是否启用自动流星；None 表示保持当前开关状态。
        """
        if min_sec > max_sec:
            min_sec, max_sec = max_sec, min_sec
        self._meteor_min = max(1.0, min_sec)
        self._meteor_max = max(self._meteor_min, max_sec)
        if enabled is not None:
            self._meteor_enabled = enabled

    def _roll_meteor_interval(self) -> float:
        """随机抽取下一次流星触发的等待时长（秒）。"""
        return random.uniform(self._meteor_min, self._meteor_max)  # noqa: S311

    def _auto_spawn_meteor(self, width: int, height: int) -> None:
        """满足条件时自动产生一颗流星（受存活上限约束）。"""
        if not self._meteor_enabled or width <= 0 or height <= 0:
            return
        live = sum(1 for e in self.effects if isinstance(e, MeteorEffect))
        if live >= self._meteor_cap:
            return
        self.add(MeteorEffect(width=width, height=height))

    def clear(self) -> None:
        """清除所有特效。"""
        self.effects.clear()
        self.canvas.clear()
        self.canvas.refresh()

    def trigger(self, name: str, **kwargs: Any) -> None:
        """触发一个命名特效。

        Args:
            name: 特效名，支持 "starfield", "aurora", "confetti", "meteor", "glow"。
            **kwargs: 特效构造参数。
        """
        if name == "starfield":
            self.add(StarfieldEffect(**kwargs))
        elif name == "aurora":
            self.add(AuroraEffect(**kwargs))
        elif name == "confetti":
            self.add(ConfettiEffect(**kwargs))
        elif name == "meteor":
            # 流星需要画布尺寸；未提供时取当前画布。
            width = kwargs.pop("width", self.canvas.canvas_width)
            height = kwargs.pop("height", self.canvas.canvas_height)
            self.add(MeteorEffect(width=width, height=height, **kwargs))
        elif name == "glow":
            target = kwargs.get("target")
            if isinstance(target, Static):
                self.add(GlowEffect(target, **{k: v for k, v in kwargs.items() if k != "target"}))

    def set_background(self, effect: Effect | None = None) -> None:
        """设置一个常驻背景特效。

        会清除已有的背景类特效（BackgroundEffect），保留一次性特效（如 Confetti）。
        """
        self.effects = [e for e in self.effects if not isinstance(e, BackgroundEffect)]
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

        # 无特效时跳过 clear/refresh（避免空转的全屏重绘开销）。
        # 仍有偶发流星倒计时需要推进，但不需要每帧清屏。
        if not self.effects:
            if self._meteor_enabled:
                self._meteor_countdown -= dt
                if self._meteor_countdown <= 0.0:
                    self._meteor_countdown = self._roll_meteor_interval()
                    self._auto_spawn_meteor(width, height)
                    # 产了流星后 effects 非空，下一帧会正常渲染
            return

        self.canvas.clear()
        for effect in self.effects:
            effect.update(dt, width, height)
            effect.render(self.canvas)
        # 清理已结束特效
        self.effects = [e for e in self.effects if e.is_alive]
        # 偶发流星自动触发：递减倒计时，到点产一颗并重新随机下一次。
        if self._meteor_enabled:
            self._meteor_countdown -= dt
            if self._meteor_countdown <= 0.0:
                self._auto_spawn_meteor(width, height)
                self._meteor_countdown = self._roll_meteor_interval()
        self.canvas.refresh()
