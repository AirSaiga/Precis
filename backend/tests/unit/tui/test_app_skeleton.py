"""@fileoverview TUI 主应用骨架单元测试

验证 PrecisTUIApp 的基础行为：
- 能在 Textual Pilot 测试模式下启动
- compose() 渲染出 Header / StatusBar（Footer 已合并到 StatusBar）
- 全局绑定（Ctrl+Q 退出）生效
- protocols.py 的 SCREEN_REGISTRY / register_screen 正确工作
"""

from __future__ import annotations

import os
import sys

import pytest

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.tui.app import PrecisTUIApp  # noqa: E402
from app.cli.tui.protocols import SCREEN_REGISTRY, register_screen  # noqa: E402
from app.cli.tui.widgets.status_bar import StatusBar  # noqa: E402


@pytest.mark.asyncio
async def test_app_starts_and_renders_header_statusbar():
    """应用在 Pilot 测试模式下应正常启动并渲染 Header 与 StatusBar。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        # Header / StatusBar 由 compose() 产出，Footer 已合并到 StatusBar
        assert app.query_one("Header") is not None
        assert app.query_one("#status-bar", StatusBar) is not None


@pytest.mark.asyncio
async def test_app_title_is_precis():
    """应用标题应为 Precis。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.title == "Precis"


@pytest.mark.asyncio
async def test_ctrl_q_binding_quits_app():
    """Ctrl+Q 绑定应触发退出。"""
    app = PrecisTUIApp()
    async with app.run_test() as pilot:
        await pilot.press("ctrl+q")
        await pilot.pause()
        # 退出后 app 应已结束运行循环
        assert app._return_value is not None or not app.is_running


def test_register_screen_adds_to_registry():
    """register_screen 装饰器应把类注册到 SCREEN_REGISTRY。"""

    @register_screen("_test_dummy_screen")
    class _DummyScreen:
        pass

    try:
        assert SCREEN_REGISTRY.get("_test_dummy_screen") is _DummyScreen
    finally:
        # 清理：避免污染其它测试与全局注册表
        SCREEN_REGISTRY.pop("_test_dummy_screen", None)


def test_register_screen_overwrites_same_name():
    """同名重复注册应覆盖旧条目（后者胜出）。"""

    @register_screen("_test_overwrite")
    class _First:
        pass

    @register_screen("_test_overwrite")
    class _Second:
        pass

    try:
        assert SCREEN_REGISTRY.get("_test_overwrite") is _Second
    finally:
        SCREEN_REGISTRY.pop("_test_overwrite", None)


def test_project_state_protocol_is_importable():
    """ProjectState 协议应可导入（结构性协议，不实例化）。"""
    from app.cli.tui.protocols import ProjectState

    # 协议仅用于类型检查，确保对象具备 project_path / project_config / is_project_open
    assert hasattr(ProjectState, "_is_protocol")
    assert ProjectState._is_protocol is True
