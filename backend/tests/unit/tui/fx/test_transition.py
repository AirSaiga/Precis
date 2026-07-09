"""屏切换过渡效果单元测试。"""

from __future__ import annotations

from typing import Any

import pytest

from app.cli.tui.fx.transition import ScreenTransition


class _FakeTimer:
    """捕获 set_interval 的伪定时器。"""

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
    """带 styles 与 mount/remove 记录的最小伪 Widget。"""

    def __init__(self) -> None:
        self.styles = _FakeStyles()
        self.mounted: list[Any] = []
        self.removed: list[Any] = []

    def mount(self, widget: Any) -> None:
        self.mounted.append(widget)

    def set_interval(self, interval: float, callback: Any) -> _FakeTimer:
        timer = _FakeTimer(interval, callback)
        self.timers.append(timer)
        return timer


class _FakeStyles:
    def __init__(self) -> None:
        self.opacity: float | None = None
        self.offset: tuple[int, int] | None = None


class _FakeApp:
    """提供 mount / set_interval 能力的最小伪 App。"""

    def __init__(self) -> None:
        self.timers: list[_FakeTimer] = []
        self.mounted: list[Any] = []
        self.removed: list[Any] = []

    def mount(self, widget: Any) -> None:
        self.mounted.append(widget)

    def set_interval(self, interval: float, callback: Any) -> _FakeTimer:
        timer = _FakeTimer(interval, callback)
        self.timers.append(timer)
        return timer


def test_transition_zero_duration_calls_callbacks() -> None:
    """duration=0 时应立即同步调用 blackout 与 done。"""
    app = _FakeApp()
    blackout_called = False
    done_called = False

    def _blackout() -> None:
        nonlocal blackout_called
        blackout_called = True

    def _done() -> None:
        nonlocal done_called
        done_called = True

    transition = ScreenTransition(app, duration=0.0)
    transition.run(_blackout, _done)

    assert blackout_called is True
    assert done_called is True
    assert not app.mounted


def test_transition_fade_direction_zero_no_offset() -> None:
    """direction=0 时只改变 opacity，offset 保持为 0。"""
    app = _FakeApp()
    transition = ScreenTransition(app, duration=0.3, direction=0)
    transition.run(lambda: None, lambda: None)

    assert len(app.timers) == 1
    timer = app.timers[0]
    overlay = app.mounted[0]
    assert overlay.styles.offset.x.value == 0
    assert overlay.styles.offset.y.value == 0

    # 触发约一半进度（30 fps，duration=0.3，约 4~5 次到一半）
    for _ in range(4):
        timer.trigger()
    assert overlay.styles.opacity == pytest.approx(0.44, abs=0.05)
    assert overlay.styles.offset.x.value == 0


def _offset_x(overlay: Any) -> float:
    """读取 overlay.styles.offset.x 的数值。"""
    return float(overlay.styles.offset.x.value)


def test_transition_slide_right_direction() -> None:
    """direction=1 时遮罩从右（+100%）扫入再向左扫出。"""
    app = _FakeApp()
    transition = ScreenTransition(app, duration=0.3, direction=1)
    transition.run(lambda: None, lambda: None)

    overlay = app.mounted[0]
    timer = app.timers[0]

    # 起始位置在右侧
    assert _offset_x(overlay) == 100

    # 触发到 phase 0 结束（进入 blackout）
    for _ in range(10):
        timer.trigger()
    assert overlay.styles.opacity == pytest.approx(1.0)
    assert _offset_x(overlay) == 0

    # phase 2：继续触发淡出
    for _ in range(10):
        timer.trigger()
    assert overlay.styles.opacity == pytest.approx(0.0, abs=0.05)
    # 最终 offset 应接近 -100
    assert _offset_x(overlay) < -50


def test_transition_slide_left_direction() -> None:
    """direction=-1 时遮罩从左（-100%）扫入再向右扫出。"""
    app = _FakeApp()
    transition = ScreenTransition(app, duration=0.3, direction=-1)
    transition.run(lambda: None, lambda: None)

    overlay = app.mounted[0]
    timer = app.timers[0]

    assert _offset_x(overlay) == -100

    for _ in range(10):
        timer.trigger()
    assert _offset_x(overlay) == 0

    for _ in range(10):
        timer.trigger()
    assert _offset_x(overlay) > 50


def test_transition_blackout_callback_timing() -> None:
    """blackout 回调应在 opacity 达到 1 后触发。"""
    app = _FakeApp()
    phases: list[str] = []

    transition = ScreenTransition(app, duration=0.3, direction=0)
    transition.run(lambda: phases.append("blackout"), lambda: phases.append("done"))

    timer = app.timers[0]
    for _ in range(20):
        timer.trigger()

    assert "blackout" in phases
    assert phases.index("blackout") < phases.index("done")


def test_transition_clamps_direction() -> None:
    """direction 应被限制在 -1/0/1 范围内。"""
    app = _FakeApp()
    assert ScreenTransition(app, direction=5).direction == 1
    assert ScreenTransition(app, direction=-5).direction == -1
    assert ScreenTransition(app, direction=0).direction == 0
