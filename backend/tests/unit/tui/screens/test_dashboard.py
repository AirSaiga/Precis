"""Dashboard 2.0 单元测试。"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from textual.app import App, ComposeResult

from app.cli.shared_services import project_ops
from app.cli.tui.app import PrecisTUIApp
from app.cli.tui.screens.dashboard import DashboardCard, DashboardScreen

# 模块级别名，便于测试私有静态方法
_format_project_stats = DashboardScreen._format_project_stats


class _HarnessApp(App):
    """仅挂载 DashboardScreen 的测试用 App。"""

    def __init__(self) -> None:
        super().__init__()
        self.project_path: str | None = None
        self.project_config: dict | None = None
        self._precis_background: str = "starfield"

    def compose(self) -> ComposeResult:
        yield DashboardScreen()

    def set_fx_background(self, name: str | None = None, **kwargs) -> None:
        pass


class _MessageCaptureApp(_HarnessApp):
    """捕获 OpenHistory 消息的测试用 App。"""

    def __init__(self) -> None:
        super().__init__()
        self.captured_paths: list[str] = []

    def on_dashboard_screen_open_history(self, event: DashboardScreen.OpenHistory) -> None:
        """捕获历史项目打开消息。"""
        event.stop()
        self.captured_paths.append(event.path)


@pytest.mark.asyncio
async def test_dashboard_renders_six_cards() -> None:
    """Dashboard 应渲染 6 张功能入口卡片。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        cards = list(screen.query(DashboardCard))
        assert len(cards) == 6


@pytest.mark.asyncio
async def test_dashboard_first_card_focused_on_mount() -> None:
    """挂载后首个卡片应自动获得焦点，并启动扫描线。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        focused = screen.focused
        assert isinstance(focused, DashboardCard)
        assert focused.entry_index == 0
        assert focused._scanline_timer is not None


@pytest.mark.asyncio
async def test_dashboard_card_scanline_breathes_on_focus() -> None:
    """卡片焦点切换时扫描线应启动/停止。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        cards = list(screen.query(DashboardCard))
        first, second = cards[0], cards[1]
        assert first._scanline_timer is not None
        assert second._scanline_timer is None
        second.focus()
        await pilot.pause()
        assert first._scanline_timer is None
        assert second._scanline_timer is not None


@pytest.mark.asyncio
async def test_dashboard_card_click_posts_goto_screen() -> None:
    """鼠标点击卡片应发送 GotoScreen 消息。"""

    class _CaptureApp(_HarnessApp):
        def __init__(self) -> None:
            super().__init__()
            self.goto_names: list[str] = []

        def on_dashboard_screen_goto_screen(self, event: DashboardScreen.GotoScreen) -> None:
            event.stop()
            self.goto_names.append(event.name)

    app = _CaptureApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        card = screen.query(DashboardCard).first()
        card.on_click()
        await pilot.pause()
        await pilot.pause()
        assert app.goto_names == [card.entry_name]


@pytest.mark.asyncio
async def test_direction_keys_move_focus_in_grid() -> None:
    """方向键应在 3×2 卡片网格中移动焦点。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        await pilot.press("right")
        await pilot.pause()
        assert isinstance(screen.focused, DashboardCard)
        assert screen.focused.entry_index == 1
        await pilot.press("down")
        await pilot.pause()
        assert screen.focused.entry_index == 4


@pytest.mark.asyncio
async def test_number_key_focuses_card() -> None:
    """数字快捷键 3 应聚焦配置卡片（索引 2）。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("3")
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        assert isinstance(screen.focused, DashboardCard)
        assert screen.focused.entry_index == 2


@pytest.mark.asyncio
async def test_history_selection_posts_open_history() -> None:
    """选择最近项目应向 App 发送 OpenHistory 消息。"""
    app = _MessageCaptureApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(DashboardScreen)
        fake_event = type(
            "OptionSelected",
            (),
            {
                "stop": lambda self: None,
                "option": type("Option", (), {"id": "/tmp/proj"})(),
            },
        )()
        screen._on_history_selected(fake_event)  # type: ignore[arg-type]
        await pilot.pause()
        assert app.captured_paths == ["/tmp/proj"]


def test_format_project_stats_counts_config_items() -> None:
    """_format_project_stats 应正确统计并格式化项目配置中的列表项。"""
    config = {
        "schemas": [{}, {}, {}],
        "constraints": [{}, {}],
        "data_sources": [{}],
        "regex_nodes": [],
        "transforms": [{}, {}, {}, {}],
    }
    stats = _format_project_stats(config)
    assert "3" in stats
    assert "Schema" in stats
    assert "2" in stats
    assert "约束" in stats
    assert "1" in stats
    assert "数据源" in stats
    assert "4" in stats
    assert "转换" in stats


def test_format_project_stats_empty_config() -> None:
    """空配置应返回空字符串。"""
    assert _format_project_stats({}) == ""
    assert _format_project_stats(None) == ""


@pytest.mark.asyncio
async def test_app_triggers_confetti_on_open_history(monkeypatch, tmp_path) -> None:
    """Dashboard 为当前屏时打开历史项目应触发 confetti 特效。"""
    history_file = tmp_path / ".precis_project_history"
    monkeypatch.setattr(project_ops, "HISTORY_FILE", str(history_file))
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "project.precis.yaml").write_text("version: 2\nproject:\n  id: test\n  name: Test\n")
    project_ops.add_to_history(str(proj))

    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        from app.cli.tui.screens.splash import SplashScreen

        if isinstance(app.screen, SplashScreen):
            await pilot.press("space")
            await pilot.pause()

        app.trigger_fx = MagicMock()  # type: ignore[method-assign]
        dashboard = app.screen
        history = dashboard.query_one("#recent-projects")
        history.highlighted = 0
        history.focus()
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        app.trigger_fx.assert_called_once_with("confetti")
