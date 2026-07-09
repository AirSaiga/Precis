"""Widget 样式动画工具单元测试。"""

from __future__ import annotations

from typing import Any

import pytest

from app.cli.tui.fx.animation import (
    StyleTween,
    animate_opacity,
    animate_tint,
    pulse_tint,
)


class _FakeTimer:
    """捕获 set_interval 回调的伪定时器。"""

    def __init__(self, interval: float, callback: Any) -> None:
        self.interval = interval
        self.callback = callback
        self._stopped = False

    def stop(self) -> None:
        self._stopped = True

    def trigger(self) -> None:
        if not self._stopped:
            self.callback()


class _FakeWidget:
    """提供 set_interval 能力的最小伪 Widget。"""

    def __init__(self) -> None:
        self.timers: list[_FakeTimer] = []
        self.styles = _FakeStyles()

    def set_interval(self, interval: float, callback: Any) -> _FakeTimer:
        timer = _FakeTimer(interval, callback)
        self.timers.append(timer)
        return timer


class _FakeStyles:
    """可记录被赋值的伪 styles 对象。"""

    def __init__(self) -> None:
        self.opacity: float | None = None
        self.tint: Any | None = None


def test_style_tween_zero_duration_calls_callbacks() -> None:
    """duration 为 0 时，on_update / on_complete 应立即同步调用。"""
    updates: list[float] = []
    completed: list[bool] = []
    widget = _FakeWidget()

    tween = StyleTween(
        widget,
        duration=0.0,
        on_update=updates.append,
        on_complete=lambda: completed.append(True),
    )
    tween.start()

    assert updates == [1.0]
    assert completed == [True]
    assert widget.timers == []


def test_style_tween_animates_via_manual_ticks() -> None:
    """手动触发 tick 应能观察到插值进度。"""
    widget = _FakeWidget()
    updates: list[float] = []

    tween = StyleTween(
        widget,
        duration=1.0,
        fps=10.0,
        easing="linear",
        on_update=updates.append,
    )
    tween.start()

    assert len(widget.timers) == 1
    timer = widget.timers[0]
    # 10 fps，每次 tick 推进 0.1；线性缓动进度等于已过时间
    for _ in range(5):
        timer.trigger()
    assert updates == pytest.approx([0.1, 0.2, 0.3, 0.4, 0.5])


def test_style_tween_stop_cleans_timer() -> None:
    widget = _FakeWidget()
    tween = StyleTween(widget, duration=1.0, fps=10.0)
    tween.start()
    assert len(widget.timers) == 1
    tween.stop()
    assert widget.timers[0]._stopped is True


def test_animate_opacity_sets_end_value_for_zero_duration() -> None:
    widget = _FakeWidget()
    animate_opacity(widget, 0.0, 1.0, duration=0.0)
    assert widget.styles.opacity == 1.0


def test_animate_opacity_interpolates() -> None:
    widget = _FakeWidget()
    animate_opacity(widget, 0.2, 0.8, duration=1.0, easing="linear")
    timer = widget.timers[0]
    timer.trigger()  # fps=20，每次推进 0.05
    assert widget.styles.opacity == pytest.approx(0.23)


def test_animate_tint_sets_color() -> None:
    """animate_tint 的 duration=0 路径会把 tint 设为 end 色。"""
    from textual.color import Color

    widget = _FakeWidget()
    animate_tint(widget, "#ff0000", "#0000ff", duration=0.0)
    assert isinstance(widget.styles.tint, Color)


def test_pulse_tint_creates_looping_timer() -> None:
    widget = _FakeWidget()
    pulse = pulse_tint(widget, "$primary 0%", "$primary 25%", duration=1.0, fps=10.0)
    assert len(widget.timers) == 1
    # 触发若干次不应自动停止
    timer = widget.timers[0]
    timer.trigger()
    timer.trigger()
    assert not timer._stopped
    pulse.stop()
    assert timer._stopped
