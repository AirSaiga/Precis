"""Sidebar 持久导航组件单元测试。"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from textual.app import App, ComposeResult

from app.cli.tui.protocols import SCREEN_REGISTRY

# 触发 @register_screen，填充 SCREEN_REGISTRY
from app.cli.tui.screens.chat import ChatScreen  # noqa: F401
from app.cli.tui.screens.config import ConfigScreen  # noqa: F401
from app.cli.tui.screens.dashboard import DashboardScreen  # noqa: F401
from app.cli.tui.screens.generate import (
    GenerateScreen,  # noqa: F401
    MigrateScreen,  # noqa: F401
)
from app.cli.tui.screens.provider import ProviderScreen  # noqa: F401
from app.cli.tui.screens.validation import ValidationScreen  # noqa: F401
from app.cli.tui.widgets.sidebar import Sidebar, SidebarItem, SidebarNavigate

if TYPE_CHECKING:
    pass


class _SidebarApp(App):
    """仅挂载 Sidebar 的测试用 App。"""

    def __init__(self, current_screen: str = "") -> None:
        super().__init__()
        self.current_screen = current_screen
        self.navigated_to: str | None = None

    def compose(self) -> ComposeResult:
        yield Sidebar(current_screen=self.current_screen, id="sidebar")

    def on_sidebar_navigate(self, event: SidebarNavigate) -> None:
        """捕获导航消息（向后兼容，实际导航由 _goto_screen 处理）。"""
        event.stop()
        self.navigated_to = event.name

    def _goto_screen(self, name: str) -> None:
        """模拟切屏（SidebarItem.on_click 直接调用此方法）。"""
        self.navigated_to = name


@pytest.mark.asyncio
async def test_sidebar_renders_all_registered_screens() -> None:
    """Sidebar 应为 SCREEN_REGISTRY 中的每个屏渲染一个导航项。"""
    app = _SidebarApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        sidebar = app.query_one("#sidebar", Sidebar)
        items = list(sidebar.query(SidebarItem))
        assert len(items) == len(SCREEN_REGISTRY)
        for item in items:
            assert item.screen_name in SCREEN_REGISTRY


@pytest.mark.asyncio
async def test_sidebar_highlights_current_screen() -> None:
    """当前屏对应的导航项应带有 active 类。"""
    app = _SidebarApp(current_screen="dashboard")
    async with app.run_test() as pilot:
        await pilot.pause()
        sidebar = app.query_one("#sidebar", Sidebar)
        active_items = [item for item in sidebar.query(SidebarItem) if item.has_class("active")]
        assert len(active_items) == 1
        assert active_items[0].screen_name == "dashboard"


@pytest.mark.asyncio
async def test_sidebar_click_posts_navigate_message() -> None:
    """点击导航项应向父级冒泡 SidebarNavigate 消息。"""
    app = _SidebarApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        sidebar = app.query_one("#sidebar", Sidebar)
        first_item = next(iter(sidebar.query(SidebarItem)))
        first_item.on_click()
        await pilot.pause()
        assert app.navigated_to == first_item.screen_name


@pytest.mark.asyncio
async def test_sidebar_toggle_collapsed() -> None:
    """Sidebar.toggle_collapsed 应切换折叠状态与导航项文案。"""
    app = _SidebarApp()
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        sidebar = app.query_one("#sidebar", Sidebar)
        # 确保从展开状态开始测试（忽略窗口宽度可能触发的自动折叠）
        sidebar.collapsed = False
        await pilot.pause()
        assert not sidebar.has_class("sidebar-collapsed")

        sidebar.toggle_collapsed()
        await pilot.pause()
        assert sidebar.collapsed
        assert sidebar.has_class("sidebar-collapsed")
        # 折叠后导航项应显示单字母图标
        for item in sidebar.query(SidebarItem):
            label = item.query_one(".sidebar-item-label")
            text = str(label.render())
            assert len(text.strip()) == 1

        sidebar.toggle_collapsed()
        await pilot.pause()
        assert not sidebar.collapsed
        assert not sidebar.has_class("sidebar-collapsed")
