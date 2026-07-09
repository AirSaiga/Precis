# backend/tests/integration/test_tui_p6.py
"""@fileoverview TUI P6 集成测试（Textual Pilot）

验证「集成打磨」产出的主 App 行为：
- App 启动后默认进入 Dashboard 屏
- 命令面板（Ctrl+P）可唤出，列出全部已注册屏
- 命令面板选中后能跳转到目标屏
- 底部 StatusBar 存在并可渲染（含项目/Provider 占位文案）
- Ctrl+Q 退出 App（App 进入退出流程）
- SCREEN_REGISTRY 在 import app 后含全部 7 个屏

mock 边界：隔离历史记录文件（避免污染 ~/.precis_project_history）；
Provider 配置走真实存储的优雅降级（无配置时显示占位，不报错）。
"""

from __future__ import annotations

import os
import sys

import pytest

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.shared_services import project_ops  # noqa: E402
from app.cli.tui.app import PrecisTUIApp  # noqa: E402
from app.cli.tui.protocols import SCREEN_REGISTRY  # noqa: E402
from app.cli.tui.screens.dashboard import DashboardCard, DashboardScreen  # noqa: E402
from app.cli.tui.widgets.command_palette import CommandPalette  # noqa: E402
from app.cli.tui.widgets.status_bar import StatusBar  # noqa: E402


@pytest.fixture
def isolated_history(tmp_path, monkeypatch):
    """将历史记录文件重定向到 tmp_path，避免污染真实 ~/.precis_project_history。"""
    history_file = tmp_path / ".precis_project_history"
    monkeypatch.setattr(project_ops, "HISTORY_FILE", str(history_file))
    return history_file


@pytest.fixture(autouse=True)
def disable_screen_transition(monkeypatch):
    """在 P6 集成测试中禁用屏切换过渡，避免 200ms 淡入淡出延迟导致断言失败。"""
    monkeypatch.setattr(PrecisTUIApp, "_transition_duration", 0.0, raising=False)


async def skip_splash(pilot) -> None:
    """跳过启动动画，等待进入 Dashboard。

    App 启动后先推 SplashScreen，按空格跳过 + pause 等待 Dashboard 就绪。
    """
    from app.cli.tui.screens.splash import SplashScreen

    await pilot.pause()
    if isinstance(pilot.app.screen, SplashScreen):
        await pilot.press("space")
        await pilot.pause()


# 预期在 SCREEN_REGISTRY 中的全部屏名（import app 后应被 @register_screen 填充）
_EXPECTED_SCREENS = {
    "dashboard",
    "validation",
    "provider",
    "config",
    "chat",
    "generate",
    "migrate",
}


@pytest.mark.asyncio
async def test_all_screens_registered_on_app_import():
    """import app 后 SCREEN_REGISTRY 应含全部 7 个屏（注册触发验证）。"""
    assert len(SCREEN_REGISTRY) >= 7
    for name in _EXPECTED_SCREENS:
        assert name in SCREEN_REGISTRY, f"屏「{name}」未注册到 SCREEN_REGISTRY"


@pytest.mark.asyncio
async def test_app_implements_project_state_protocol():
    """PrecisTUIApp 应实现 ProjectState 协议（project_path/project_config/is_project_open）。"""
    app = PrecisTUIApp()
    assert app.project_path is None
    assert app.project_config is None
    assert app.is_project_open is False
    # 可写
    app.project_path = "/tmp/x"
    assert app.is_project_open is True


@pytest.mark.asyncio
async def test_app_starts_on_dashboard(isolated_history):
    """App 启动后默认屏应为 Dashboard。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        assert isinstance(app.screen, DashboardScreen)


@pytest.mark.asyncio
async def test_dashboard_renders_quick_entries_and_history(isolated_history):
    """Dashboard 应渲染功能入口卡片网格与最近项目列表（即使历史为空也显示占位）。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        dashboard = app.screen
        assert isinstance(dashboard, DashboardScreen)
        # 功能入口卡片应有 _QUICK_ENTRIES 数量（6 个）
        cards = list(dashboard.query(DashboardCard))
        assert len(cards) == 6
        # 最近项目列表：历史为空时应有 1 个占位选项
        history_list = dashboard.query_one("#recent-projects")
        assert history_list.option_count == 1


@pytest.mark.asyncio
async def test_status_bar_exists_and_renders(isolated_history):
    """StatusBar 应存在并能渲染文案（含项目占位 + Provider 部分）。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        status_bar = app.query_one("#status-bar", StatusBar)
        # 刷新后不抛异常
        status_bar.refresh_state(app)
        await pilot.pause()
        # StatusBar 继承 Static；refresh_state 通过 update 写入新文案，
        # 后续 render 应返回非空字符串（含「未打开项目」与「Provider」占位）
        rendered = status_bar.render()
        rendered_str = str(rendered)
        assert "未打开项目" in rendered_str
        assert "Provider" in rendered_str


@pytest.mark.asyncio
async def test_command_palette_invoked_and_lists_screens(isolated_history):
    """Ctrl+P 应唤出命令面板，面板应列出全部已注册屏。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        # 触发命令面板动作
        await pilot.press("ctrl+p")
        await pilot.pause()
        # 栈顶应为 CommandPalette 模态屏
        assert isinstance(app.screen, CommandPalette)
        option_list = app.screen.query_one("#palette-list")
        # 选项数应等于 SCREEN_REGISTRY 的大小（所有注册屏）
        assert option_list.option_count == len(SCREEN_REGISTRY)


@pytest.mark.asyncio
async def test_command_palette_navigation_jumps_to_screen(isolated_history):
    """命令面板选中 validation 屏后应跳转到 ValidationScreen。"""
    from app.cli.tui.screens.validation import ValidationScreen

    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        # 唤出面板
        await pilot.press("ctrl+p")
        await pilot.pause()
        assert isinstance(app.screen, CommandPalette)

        # 在面板里选中 validation（选项 id="validation"），用回车确认
        option_list = app.screen.query_one("#palette-list")
        target_idx = None
        for i in range(option_list.option_count):
            if option_list.get_option_at_index(i).id == "validation":
                target_idx = i
                break
        assert target_idx is not None, "命令面板未列出 validation 屏"

        # 高亮目标项并聚焦，再用回车触发 OptionSelected
        option_list.highlighted = target_idx
        option_list.focus()
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()

        # 跳转后栈顶应为 ValidationScreen
        assert isinstance(app.screen, ValidationScreen)


@pytest.mark.asyncio
async def test_goto_unknown_screen_notifies(isolated_history):
    """_goto_screen 跳转未注册的屏时应通知错误，不崩溃。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        # 未注册的屏名
        app._goto_screen("__nonexistent__")
        await pilot.pause()
        # App 仍存活，屏仍是 Dashboard（未跳走）
        assert isinstance(app.screen, DashboardScreen)


@pytest.mark.asyncio
async def test_quit_binding_requests_exit(isolated_history):
    """Ctrl+Q 应触发退出（App 进入退出流程）。

    run_test 下按 ctrl+q 后 app._exit 应被设置或退出被请求；
    用 app.is_running 在退出上下文后转为 False 来间接验证（context 退出即表示已退出）。
    """
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        await pilot.press("ctrl+q")
        await pilot.pause()
        # ctrl+q 触发 quit 动作后，App 会开始退出流程
        # 在 run_test 上下文内退出可能未立即完成，检查退出标志
        assert app._exit  # noqa: SLF001 - 检测退出标志被设置


@pytest.mark.asyncio
async def test_dashboard_quick_entry_navigation(isolated_history):
    """Dashboard 选中功能入口卡片应跳转到对应屏（经 GotoScreen 消息）。"""
    from app.cli.tui.screens.provider import ProviderScreen

    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        dashboard = app.screen
        # provider 卡片索引为 1
        cards = list(dashboard.query(DashboardCard))
        provider_card = cards[1]
        provider_card.focus()
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        assert isinstance(app.screen, ProviderScreen)


@pytest.mark.asyncio
async def test_dashboard_open_history_updates_state(qa_simple_copy, isolated_history):
    """Dashboard 选中最近项目应打开并更新 App 的 project_path。"""
    # 预置历史
    project_ops.add_to_history(str(qa_simple_copy))

    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await skip_splash(pilot)
        dashboard = app.screen
        # 历史列表首项即 qa_simple 副本
        history = dashboard.query_one("#recent-projects")
        assert history.option_count >= 1
        first = history.get_option_at_index(0)
        assert first.id == str(qa_simple_copy)
        # 高亮首项并聚焦后回车
        history.highlighted = 0
        history.focus()
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        # App 全局状态应更新
        assert app.is_project_open is True
        assert app.project_path == str(qa_simple_copy)
        assert app.project_config is not None


# ── 辅助 fixture（qa_simple 真实项目副本）──────────────────────────────────

from pathlib import Path  # noqa: E402

QA_SIMPLE_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "qa_simple"


@pytest.fixture
def qa_simple_copy(tmp_path):
    """复制 qa_simple 真实项目到 tmp_path，避免污染源文件。"""
    if not QA_SIMPLE_ROOT.is_dir():
        pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")
    proj = tmp_path / "qa_simple"
    import shutil

    shutil.copytree(QA_SIMPLE_ROOT, proj)
    return proj
