"""增强版 Toast 通知系统测试。"""

from __future__ import annotations

import pytest
from textual.app import App, ComposeResult
from textual.css.query import NoMatches
from textual.widgets import Static
from textual.widgets._toast import ToastRack

from app.cli.tui.screens.base import BaseScreen
from app.cli.tui.widgets.toast import AnimatedToast, AnimatedToastRack


class _ToastScreen(BaseScreen):
    """用于测试的 BaseScreen 子类。"""

    screen_name = "toast-test"
    enable_entrance = False

    def compose_content(self) -> ComposeResult:
        yield Static("测试内容", id="toast-content")


class _ToastApp(App):
    """用于测试的 App，默认只渲染一个占位控件，并重写通知刷新以支持 AnimatedToastRack。"""

    def compose(self) -> ComposeResult:
        yield Static("测试占位", id="toast-placeholder")

    def _refresh_notifications(self) -> None:
        """与 PrecisTUIApp 保持一致：接受 ToastRack 子类作为通知容器。"""
        try:
            screen = self.screen
        except Exception:  # noqa: BLE001
            return
        try:
            toast_rack = screen.query_one(ToastRack)
        except NoMatches:
            return
        self.call_later(toast_rack.show, self._notifications)


@pytest.mark.asyncio
async def test_basescreen_uses_animated_toast_rack() -> None:
    """BaseScreen 应把默认 ToastRack 替换为 AnimatedToastRack。"""
    app = _ToastApp()
    async with app.run_test(tooltips=True, notifications=True) as pilot:
        await pilot.pause()
        await app.push_screen(_ToastScreen())
        await pilot.pause()
        screen = app.screen
        assert isinstance(screen, _ToastScreen)
        rack = screen.query_one("#textual-toastrack", AnimatedToastRack)
        assert rack is not None
        assert isinstance(rack, ToastRack)
        # Tooltip 也应被保留
        assert screen.query_one("#textual-tooltip") is not None


@pytest.mark.asyncio
async def test_notify_creates_animated_toast() -> None:
    """App.notify 应弹出 AnimatedToast 并包含通知内容。"""
    app = _ToastApp()
    async with app.run_test(tooltips=True, notifications=True) as pilot:
        await pilot.pause()
        await app.push_screen(_ToastScreen())
        await pilot.pause()
        app.notify("操作已成功", title="完成", severity="information", timeout=60)
        await pilot.pause()

        screen = app.screen
        assert isinstance(screen, _ToastScreen)
        toasts = list(screen.query(AnimatedToast))
        assert len(toasts) == 1
        rendered = str(toasts[0].render())
        assert "操作已成功" in rendered
        assert "完成" in rendered


@pytest.mark.asyncio
async def test_error_toast_triggers_shake(monkeypatch) -> None:
    """错误级别的 Toast 应触发水平抖动。"""
    shake_calls: list[AnimatedToast] = []

    def _fake_shake(self: AnimatedToast) -> None:
        shake_calls.append(self)

    monkeypatch.setattr(AnimatedToast, "_play_shake", _fake_shake)

    app = _ToastApp()
    async with app.run_test(tooltips=True, notifications=True) as pilot:
        await pilot.pause()
        await app.push_screen(_ToastScreen())
        await pilot.pause()
        app.notify("保存失败", title="错误", severity="error", timeout=60)
        # _play_enter_animation 在 0.28s 后触发抖动
        await pilot.pause(0.35)

        assert len(shake_calls) == 1
        assert isinstance(shake_calls[0], AnimatedToast)


@pytest.mark.asyncio
async def test_non_error_toast_does_not_shake(monkeypatch) -> None:
    """非错误级别的 Toast 不应触发抖动。"""
    shake_calls: list[AnimatedToast] = []

    def _fake_shake(self: AnimatedToast) -> None:
        shake_calls.append(self)

    monkeypatch.setattr(AnimatedToast, "_play_shake", _fake_shake)

    app = _ToastApp()
    async with app.run_test(tooltips=True, notifications=True) as pilot:
        await pilot.pause()
        await app.push_screen(_ToastScreen())
        await pilot.pause()
        app.notify("仅作提示", severity="warning", timeout=60)
        await pilot.pause(0.35)

        assert len(shake_calls) == 0


def test_animated_toast_rack_inherits_no_css() -> None:
    """AnimatedToastRack 应保持 inherit_css=False，避免全局 CSS 污染。"""
    assert AnimatedToastRack.inherit_css is False
