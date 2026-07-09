"""BaseScreen 基类单元测试。"""

from __future__ import annotations

from typing import Any

import pytest
from textual.app import App, ComposeResult
from textual.widgets import Static

from app.cli.tui.screens import base as base_screen_module
from app.cli.tui.screens.base import BaseScreen
from app.cli.tui.widgets.sidebar import Sidebar


class _TestScreen(BaseScreen):
    """用于测试的 BaseScreen 子类。"""

    screen_name = "test-screen"
    enable_entrance = False

    def compose_content(self) -> ComposeResult:
        yield Static("测试内容", id="test-content")


class _BaseScreenApp(App):
    """挂载 _TestScreen 并记录跳转请求的测试 App。"""

    def __init__(self) -> None:
        super().__init__()
        self.last_goto: str | None = None

    def compose(self) -> ComposeResult:
        yield _TestScreen()

    def _goto_screen(self, name: str) -> None:
        self.last_goto = name


@pytest.mark.asyncio
async def test_base_screen_renders_sidebar_and_content() -> None:
    """BaseScreen 应渲染 Sidebar 与 content-area 内容。"""
    app = _BaseScreenApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(_TestScreen)
        sidebar = screen.query_one("#sidebar", Sidebar)
        content = screen.query_one("#test-content", Static)
        assert sidebar is not None
        assert content is not None
        assert sidebar.current_screen == "test-screen"


@pytest.mark.asyncio
async def test_base_screen_navigate_routes_to_app() -> None:
    """Sidebar 导航消息应经 BaseScreen 转发给 App._goto_screen。"""
    app = _BaseScreenApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(_TestScreen)
        screen.on_sidebar_navigate(Sidebar.Navigate("validation"))
        await pilot.pause()
        assert app.last_goto == "validation"


class _EntranceTestScreen(BaseScreen):
    """用于测试入场动效的子类。"""

    screen_name = "entrance-test"
    enable_entrance = True
    ENTRANCE_DELAY = 0.05
    ENTRANCE_DURATION = 0.15

    def compose_content(self) -> ComposeResult:
        for i in range(3):
            yield Static(f"item-{i}", classes="entrance-item")


class _EntranceApp(App):
    def compose(self) -> ComposeResult:
        yield _EntranceTestScreen()


@pytest.mark.asyncio
async def test_base_screen_entrance_stagger(monkeypatch) -> None:
    """入场动效应按 ENTRANCE_DELAY 错开调用 animate_opacity。"""
    animate_calls: list[tuple[Any, ...]] = []
    timer_delays: list[float] = []

    def _fake_animate_opacity(widget: Any, start: float, end: float, **kwargs: Any) -> None:
        animate_calls.append((widget, start, end, kwargs.get("duration")))

    def _fake_set_timer(self: Any, delay: float, callback: Any) -> None:
        timer_delays.append(delay)
        callback()

    monkeypatch.setattr(base_screen_module, "animate_opacity", _fake_animate_opacity)
    monkeypatch.setattr(BaseScreen, "set_timer", _fake_set_timer)

    app = _EntranceApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(_EntranceTestScreen)
        items = list(screen.query(".entrance-item"))

        assert len(items) == 3
        assert len(animate_calls) == 3
        # idx=0 的 delay 经 max(0.01, 0.0) 兜底为 0.01，避免 set_timer(0,...)
        # 触发 ZeroDivisionError；其余按 ENTRANCE_DELAY 错开。
        assert timer_delays == pytest.approx([0.01, 0.05, 0.1])
        for idx, (widget, start, end, duration) in enumerate(animate_calls):
            assert widget is items[idx]
            assert start == 0.0
            assert end == 1.0
            assert duration == screen.ENTRANCE_DURATION


@pytest.mark.asyncio
async def test_base_screen_focus_glow_receives_focus_events() -> None:
    """BaseScreen 应把 descendant focus/blur 事件转发给 FocusGlow。"""

    class _FocusTestScreen(BaseScreen):
        screen_name = "focus-test"
        enable_entrance = False

        def compose_content(self) -> ComposeResult:
            yield Static("focusable", id="focus-node")

    class _FocusApp(App):
        def compose(self) -> ComposeResult:
            yield _FocusTestScreen()

    app = _FocusApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(_FocusTestScreen)
        node = app.query_one("#focus-node", Static)
        screen.on_descendant_focus(type("Event", (), {"control": node})())
        assert screen._focus_glow._current is node
        screen.on_descendant_blur(type("Event", (), {"control": node})())
        assert screen._focus_glow._current is None
