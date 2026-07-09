"""焦点高亮服务单元测试。

FocusGlow 在架构重构 #2 后改为静态高亮（不再用呼吸定时器）：获得焦点时
给 widget 设置主题色边框，失焦时恢复 transparent 边框。本测试验证这套
静态高亮的 apply/clear/toggle/stop 行为。
"""

from __future__ import annotations

from typing import Any

from app.cli.tui.fx.focus_glow import FocusGlow


class _FakeStyles:
    """记录被赋值的 border 的伪 styles 对象。"""

    def __init__(self) -> None:
        self.border: Any | None = None


class _FakeWidget:
    def __init__(self) -> None:
        self.styles = _FakeStyles()


class _FakeScreen:
    pass


def test_focus_glow_enabled_by_default() -> None:
    glow = FocusGlow(_FakeScreen())
    assert glow.enabled is True


def test_focus_glow_applies_border_on_focus() -> None:
    """获得焦点时应设置 GLOW_BORDER。"""
    glow = FocusGlow(_FakeScreen())
    widget = _FakeWidget()
    glow.on_focus(widget)
    assert glow._current is widget
    assert widget.styles.border == glow.GLOW_BORDER


def test_focus_glow_clears_border_on_blur() -> None:
    """失焦时应恢复 transparent 边框。"""
    glow = FocusGlow(_FakeScreen())
    widget = _FakeWidget()
    glow.on_focus(widget)
    glow.on_blur(widget)
    assert glow._current is None
    assert widget.styles.border == ("none", "transparent")


def test_focus_glow_blur_other_widget_is_ignored() -> None:
    glow = FocusGlow(_FakeScreen())
    widget = _FakeWidget()
    glow.on_focus(widget)
    other = _FakeWidget()
    glow.on_blur(other)
    assert glow._current is widget


def test_focus_glow_toggle_disabled_clears_border() -> None:
    """禁用高亮时应清除当前 widget 的边框。"""
    glow = FocusGlow(_FakeScreen())
    widget = _FakeWidget()
    glow.on_focus(widget)
    enabled = glow.toggle()
    assert enabled is False
    assert widget.styles.border == ("none", "transparent")


def test_focus_glow_toggle_re_enable_reapplies_border() -> None:
    """重新启用后应重新应用高亮边框。"""
    glow = FocusGlow(_FakeScreen())
    widget = _FakeWidget()
    glow.on_focus(widget)
    glow.toggle()  # disable → clears border
    glow.toggle()  # enable → reapplies border
    assert glow.enabled is True
    assert widget.styles.border == glow.GLOW_BORDER


def test_focus_glow_disabled_still_tracks_current() -> None:
    """禁用态下仍记录 current，但不应用边框。"""
    glow = FocusGlow(_FakeScreen())
    glow.toggle()  # disable
    widget = _FakeWidget()
    glow.on_focus(widget)
    assert glow._current is widget
    assert widget.styles.border is None


def test_focus_glow_stop_cleans_up() -> None:
    glow = FocusGlow(_FakeScreen())
    widget = _FakeWidget()
    glow.on_focus(widget)
    glow.stop()
    assert glow._current is None
    assert widget.styles.border == ("none", "transparent")


def test_focus_glow_set_enabled_no_op_when_same() -> None:
    glow = FocusGlow(_FakeScreen())
    glow.set_enabled(True)
    assert glow.enabled is True
    glow.set_enabled(False)
    assert glow.enabled is False
    glow.set_enabled(False)
    assert glow.enabled is False
