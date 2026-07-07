# backend/tests/integration/test_tui_p1.py
"""@fileoverview TUI P1 集成测试（Textual Pilot）

验证「打开项目 + 执行校验 + 展示结果」闭环：
- 用 qa_test/qa_simple 真实项目（复制到 tmp_path 避免污染源）
- 挂载 ValidationScreen，从历史列表打开项目，执行校验
- 断言错误表格含行、摘要日志含关键文本
- 校验结果与 CLI standalone 模式数据层一致（errors 数量与类型）

mock 边界：真实 ValidationExecutor（用 qa_simple 真实数据，证明端到端可用）。
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import pytest

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from textual.app import App, ComposeResult  # noqa: E402

from app.cli.shared_services import project_ops  # noqa: E402
from app.cli.tui.protocols import SCREEN_REGISTRY  # noqa: E402
from app.cli.tui.screens.validation import ValidationScreen  # noqa: E402

# qa_test/qa_simple 是仓库内置的最小可运行 V2 项目
QA_SIMPLE_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "qa_simple"


class _HarnessApp(App):
    """挂载 ValidationScreen 的测试用 App。

    实现 ProjectState 协议（project_path/project_config/is_project_open），
    供 ValidationScreen 读写全局项目状态。
    """

    def __init__(self) -> None:
        super().__init__()
        self.project_path: str | None = None
        self.project_config: dict | None = None

    @property
    def is_project_open(self) -> bool:
        return self.project_path is not None

    def compose(self) -> ComposeResult:
        yield ValidationScreen()


@pytest.fixture
def qa_simple_copy(tmp_path):
    """复制 qa_simple 真实项目到 tmp_path，避免污染源文件。"""
    if not QA_SIMPLE_ROOT.is_dir():
        pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")
    proj = tmp_path / "qa_simple"
    shutil.copytree(QA_SIMPLE_ROOT, proj)
    return proj


@pytest.fixture
def isolated_history(tmp_path, monkeypatch):
    """将历史记录文件重定向到 tmp_path，避免污染真实 ~/.precis_project_history。"""
    history_file = tmp_path / ".precis_project_history"
    monkeypatch.setattr(project_ops, "HISTORY_FILE", str(history_file))
    return history_file


def _richlog_text(log) -> str:
    """从 RichLog.lines（Strip 列表）拼接纯文本，便于断言。"""
    return "\n".join(getattr(line, "text", "") or "" for line in log.lines)


@pytest.mark.asyncio
async def test_validation_screen_registered_in_registry():
    """ValidationScreen 应注册到 SCREEN_REGISTRY（@register_screen("validation")）。"""
    assert SCREEN_REGISTRY.get("validation") is ValidationScreen


@pytest.mark.asyncio
async def test_open_project_from_history_updates_state(qa_simple_copy, isolated_history):
    """从历史列表打开 qa_simple 应更新 App 的项目状态。"""
    # 预置历史：把 qa_simple 副本加入历史
    project_ops.add_to_history(str(qa_simple_copy))
    assert project_ops.load_history(), "历史预置失败"

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        assert screen.is_project_open is False

        # 选中历史列表首项触发打开
        history_list = screen.query_one("#history-list")
        history_list.index = 0
        # 触发 selected（ListView.index 赋值会触发 Highlighted，selected 需 enter）
        await pilot.press("enter")
        await pilot.pause()

        # 状态应已更新到 qa_simple 副本
        assert app.is_project_open is True
        assert app.project_path == str(qa_simple_copy)
        assert app.project_config is not None
        # qa_simple 的 project.name 在仓库中是固定的
        assert app.project_config.get("project", {}).get("name") == "QA 测试工程（统一测试集）"


@pytest.mark.asyncio
async def test_open_and_validate_qa_simple(qa_simple_copy, isolated_history):
    """打开 qa_simple 并执行校验，错误表格应含行、摘要应含耗时与约束检查文本。"""
    project_ops.add_to_history(str(qa_simple_copy))

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)

        # 打开项目
        history_list = screen.query_one("#history-list")
        history_list.index = 0
        await pilot.press("enter")
        await pilot.pause()
        assert screen.is_project_open is True

        # 触发校验（直接调 action_validate；qa_simple 同步校验会在调用期间完成）
        await screen.action_validate()
        await pilot.pause()

        # 校验错误表格应有行（qa_simple 含故意违规数据）
        from textual.widgets import DataTable

        table = screen.query_one("#error-table", DataTable)
        assert table.row_count > 0, "qa_simple 含故意违规数据，错误表格不应为空"
        # 列应为 表/字段/行号/约束/消息（5 列）
        assert len(table.ordered_columns) == 5

        # 摘要日志应含关键文本
        log = screen.query_one("#summary-log")
        joined = _richlog_text(log)
        assert "校验耗时" in joined
        assert "约束检查" in joined


@pytest.mark.asyncio
async def test_validate_without_open_project_shows_prompt(qa_simple_copy, isolated_history):
    """未打开项目时点击校验应在摘要区提示，不崩溃。"""
    # 不预置历史，列表为空
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        assert screen.is_project_open is False

        await screen.action_validate()
        await pilot.pause()

        log = screen.query_one("#summary-log")
        joined = _richlog_text(log)
        assert "请先从左侧历史列表打开一个项目" in joined


@pytest.mark.asyncio
async def test_tui_validation_matches_cli_standalone(qa_simple_copy, isolated_history):
    """TUI 校验的 errors 数量应与 CLI standalone 模式一致（数据层对比）。"""
    from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

    manifest = qa_simple_copy / "project.precis.yaml"
    data_dir = qa_simple_copy / "data"

    # CLI/standalone 基线：直接调 executor
    options = ValidationOptions(timeout_seconds=30, allow_unsafe_eval=True, table_filter=None)
    baseline = ValidationExecutor(str(manifest)).execute(str(data_dir), options)
    baseline_errors = baseline.get("errors", [])

    # TUI 路径：经 ValidationService
    project_ops.add_to_history(str(qa_simple_copy))
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        history_list = screen.query_one("#history-list")
        history_list.index = 0
        await pilot.press("enter")
        await pilot.pause()

        await screen.action_validate()
        await pilot.pause()

        from textual.widgets import DataTable

        table = screen.query_one("#error-table", DataTable)
        # TUI 表格行数与基线 errors 数量一致
        assert table.row_count == len(baseline_errors), (
            f"TUI 表格行数 {table.row_count} != 基线 errors 数 {len(baseline_errors)}"
        )
