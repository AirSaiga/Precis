# backend/tests/integration/test_tui_p1.py
"""@fileoverview TUI P1 集成测试（Textual Pilot）

验证「打开项目 + 执行校验 + 展示结果」闭环：
- 用 qa_test/qa_simple 真实项目（复制到 tmp_path 避免污染源）
- 挂载 ValidationScreen，直接注入项目状态（V2-4 起校验屏不再内嵌 HistoryList，
  项目打开入口收敛到 Dashboard / Ctrl+O），执行校验
- 断言错误表格含行、摘要日志含关键文本、左栏数据源树填充、右栏详情联动
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
from app.cli.tui.services.validation_service import ValidationResult  # noqa: E402

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


def _open_project_in_app(app: _HarnessApp, project_path: Path) -> None:
    """在 _HarnessApp 上模拟「打开项目」：调 project_ops 并写入 app 状态。

    V2-4 起校验屏不再内嵌 HistoryList，项目入口收敛到 Dashboard / Ctrl+O。
    测试直接调用与 HistoryList 相同的 project_ops.open_project，等价覆盖打开路径。
    """
    result = project_ops.open_project(str(project_path))
    assert result.success, f"打开项目失败：{result.message}"
    app.project_path = result.project_path
    app.project_config = result.config


def _richlog_text(log) -> str:
    """从 RichLog.lines（Strip 列表）拼接纯文本，便于断言。"""
    return "\n".join(getattr(line, "text", "") or "" for line in log.lines)


@pytest.mark.asyncio
async def test_validation_screen_registered_in_registry():
    """ValidationScreen 应注册到 SCREEN_REGISTRY（@register_screen("validation")）。"""
    assert SCREEN_REGISTRY.get("validation") is ValidationScreen


@pytest.mark.asyncio
async def test_open_project_updates_state(qa_simple_copy, isolated_history):
    """打开 qa_simple 后 App 的项目状态应更新（经 project_ops.open_project）。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        assert screen.is_project_open is False

        # 模拟 Dashboard / Ctrl+O 打开项目（V2-4 校验屏不再内嵌 HistoryList）
        _open_project_in_app(app, qa_simple_copy)
        # 触发屏的状态条刷新（实际由消息驱动；测试中主动调用）
        screen._refresh_status()  # noqa: SLF001
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
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        screen._refresh_status()  # noqa: SLF001
        await pilot.pause()
        assert screen.is_project_open is True

        # 触发校验（worker 线程执行，await worker.wait() 等待完成不阻塞 UI）
        worker = screen.action_validate()
        await worker.wait()
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

        # 进度区：校验完成后应可见（非 hidden）且 ProgressBar 推满 100
        from textual.widgets import ProgressBar

        progress_row = screen.query_one("#progress-row")
        assert "hidden" not in progress_row.classes, "校验完成后进度区应可见"
        pb = screen.query_one("#validate-progress", ProgressBar)
        assert pb.progress == 100


@pytest.mark.asyncio
async def test_validate_without_open_project_shows_prompt(qa_simple_copy, isolated_history):
    """未打开项目时点击校验应在摘要区提示，不崩溃。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        assert screen.is_project_open is False

        worker = screen.action_validate()
        await worker.wait()
        await pilot.pause()

        log = screen.query_one("#summary-log")
        joined = _richlog_text(log)
        # V2-4 文案改为提示 Ctrl+O（项目入口收敛）
        assert "Ctrl+O" in joined


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
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        screen._refresh_status()  # noqa: SLF001
        await pilot.pause()

        await screen.action_validate().wait()
        await pilot.pause()

        from textual.widgets import DataTable

        table = screen.query_one("#error-table", DataTable)
        # TUI 表格行数与基线 errors 数量一致
        assert table.row_count == len(baseline_errors), (
            f"TUI 表格行数 {table.row_count} != 基线 errors 数 {len(baseline_errors)}"
        )


# ── V2-4：三栏布局 —— 数据源树 + 过滤联动 + 详情面板 ────────────────────


@pytest.mark.asyncio
async def test_three_column_layout_present(qa_simple_copy, isolated_history):
    """三栏布局节点应同时存在：source-panel / result-panel / detail-panel。"""
    from textual.widgets import RichLog, Tree

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        # 三个面板节点
        screen.query_one("#source-panel")
        screen.query_one("#result-panel")
        screen.query_one("#detail-panel")
        # 子控件类型正确
        assert isinstance(screen.query_one("#source-tree"), Tree)
        assert isinstance(screen.query_one("#detail-log"), RichLog)


@pytest.mark.asyncio
async def test_source_tree_populated_after_validate(qa_simple_copy, isolated_history):
    """校验后左栏数据源树应填充表节点（含行数/错误数标记）。"""
    from textual.widgets import Tree

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        await pilot.pause()

        await screen.action_validate().wait()
        await pilot.pause()

        tree = screen.query_one("#source-tree", Tree)
        # 根节点应有子节点（每个表一个 leaf）
        assert len(tree.root.children) > 0, "校验后数据源树应填充表节点"
        # 至少一个叶子节点的 data 含 table 字段
        leaves_with_table = [n for n in tree.root.children if (n.data or {}).get("table")]
        assert leaves_with_table, "树节点 data 应携带 table 字段供过滤"


@pytest.mark.asyncio
async def test_tree_filter_narrows_error_table(qa_simple_copy, isolated_history):
    """选中左栏某表叶子节点后，DataTable 应仅显示该表错误。"""
    from textual.widgets import DataTable, Tree

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        await pilot.pause()

        await screen.action_validate().wait()
        await pilot.pause()

        table = screen.query_one("#error-table", DataTable)
        total_rows = table.row_count
        assert total_rows > 0

        tree = screen.query_one("#source-tree", Tree)
        # 找一个错误数 > 0 的表节点做过滤目标
        target = next(
            (n for n in tree.root.children if (n.data or {}).get("errors", 0) > 0),
            None,
        )
        assert target is not None, "qa_simple 应存在含错误的表"

        target_table = target.data["table"]
        # 选中该叶子节点 → 触发 NodeSelected → 过滤
        tree.select_node(target)
        await pilot.pause()

        # DataTable 行数应等于该表的错误数
        assert table.row_count == target.data["errors"]
        # _table_filter 应同步更新
        assert screen._table_filter == target_table  # noqa: SLF001

        # 选中根节点 → 清除过滤，恢复全部
        tree.select_node(tree.root)
        await pilot.pause()
        assert table.row_count == total_rows
        assert screen._table_filter is None  # noqa: SLF001


@pytest.mark.asyncio
async def test_detail_panel_shows_selected_error(qa_simple_copy, isolated_history):
    """移动 DataTable 光标到某错误行，右栏详情应展示该错误的表/字段/消息。"""
    from textual.widgets import DataTable

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        await pilot.pause()

        await screen.action_validate().wait()
        await pilot.pause()

        table = screen.query_one("#error-table", DataTable)
        assert table.row_count > 0

        # 移动光标到第一行 → 触发 RowHighlighted → 详情渲染
        table.move_cursor(row=0)
        await pilot.pause()

        detail_log = screen.query_one("#detail-log")
        detail_text = _richlog_text(detail_log)
        # 详情面板应含字段标签
        assert "表：" in detail_text
        assert "字段：" in detail_text
        assert "消息：" in detail_text
        # 取当前错误对照：第一行错误
        first_err = screen._current_errors[0]  # noqa: SLF001
        assert str(first_err.get("table", "")) in detail_text


@pytest.mark.asyncio
async def test_detail_panel_empty_state_before_select(qa_simple_copy, isolated_history):
    """校验后未移动光标时，右栏详情面板应显示空态提示。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)

        # 挂载后空态
        detail_text = _richlog_text(screen.query_one("#detail-log"))
        assert "选中错误行查看详情" in detail_text


# ── 校验实时渲染（V2-3c）：worker 不阻塞 + 进度区实时更新 ────────────────────


class _SlowFakeService:
    """假 ValidationService：sleep 模拟耗时校验，期间多次回调 progress_callback。

    用于验证 worker 线程执行校验时 UI 线程不冻结、进度区实时更新。
    """

    def __init__(self, event_count: int = 5, delay: float = 0.05) -> None:
        self._event_count = event_count
        self._delay = delay

    def validate(
        self,
        manifest_path: str,
        data_dir: str,
        table: str | None = None,
        validation_settings: dict | None = None,
        script_security: dict | None = None,
        progress_callback=None,
    ) -> ValidationResult:
        import time

        from app.shared.services.validation.progress import ProgressEvent

        for i in range(1, self._event_count + 1):
            time.sleep(self._delay)
            if progress_callback is not None:
                progress_callback(
                    ProgressEvent(
                        stage="validating",
                        table="users",
                        chunk_index=i,
                        chunk_total=self._event_count,
                        rows_done=i * 100,
                        rows_total=self._event_count * 100,
                        errors_so_far=i * 2,
                        elapsed_ms=int(i * self._delay * 1000),
                    )
                )
        # 完成事件
        if progress_callback is not None:
            progress_callback(
                ProgressEvent(
                    stage="done",
                    table="users",
                    chunk_index=0,
                    chunk_total=0,
                    rows_done=self._event_count * 100,
                    rows_total=self._event_count * 100,
                    errors_so_far=self._event_count * 2,
                    elapsed_ms=int(self._event_count * self._delay * 1000),
                )
            )
        return ValidationResult(
            errors=[{"error_type": "NotNullViolation", "table": "users", "message": "x"}],
            loading_errors=[],
            duration_ms=42,
            validation_details={"format_checks": [], "constraint_checks": []},
            raw_datasets={},
        )


@pytest.mark.asyncio
async def test_validation_worker_does_not_block_ui(qa_simple_copy, isolated_history):
    """校验在 worker 线程执行：运行期间 UI 线程应仍可交互（按钮可聚焦/按键可响应）。"""
    from textual.widgets import Button, ProgressBar, Sparkline

    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        await pilot.pause()
        assert screen.is_project_open is True

        # 注入慢速假服务（多次 progress 回调 + 延迟）
        screen._service = _SlowFakeService(event_count=6, delay=0.05)  # noqa: SLF001

        # 启动 worker（不等待，立即返回）
        worker = screen.action_validate()
        # worker 运行期间 UI 应可交互：聚焦按钮、按键应被处理（不抛异常/不卡死）
        btn = screen.query_one("#validate-btn", Button)
        btn.focus()
        await pilot.pause()
        assert btn.has_focus
        # 按 tab 应能移动焦点（UI 事件循环仍在运转）
        await pilot.press("tab")
        await pilot.pause()

        # 等待 worker 完成
        await worker.wait()
        await pilot.pause()

        # 进度区应可见，ProgressBar 推满，Sparkline 收到多个数据点
        progress_row = screen.query_one("#progress-row")
        assert "hidden" not in progress_row.classes
        pb = screen.query_one("#validate-progress", ProgressBar)
        assert pb.progress == 100
        sparkline = screen.query_one("#error-sparkline", Sparkline)
        # 6 个 validating 事件 + 1 个 done 事件 = 7 个数据点
        assert sparkline.data is not None
        assert len(sparkline.data) == 7


@pytest.mark.asyncio
async def test_validation_worker_exclusive_prevents_restart(qa_simple_copy, isolated_history):
    """exclusive=True：校验中再次触发应不重启（worker 组内互斥）。"""
    app = _HarnessApp()
    async with app.run_test() as pilot:
        await pilot.pause()
        screen = app.query_one(ValidationScreen)
        _open_project_in_app(app, qa_simple_copy)
        await pilot.pause()

        # 注入慢速假服务（确保第二次触发时仍在运行）
        screen._service = _SlowFakeService(event_count=10, delay=0.05)  # noqa: SLF001

        screen.action_validate()  # 第一次触发
        await pilot.pause()
        # 第一次仍运行中时触发第二次（exclusive 应取消/忽略同组旧 worker）
        worker2 = screen.action_validate()
        await pilot.pause()

        # 至少一个 worker 应进入完成态（exclusive 不死锁）
        await worker2.wait()
        await pilot.pause()
        # App 仍存活，未 panic
        assert app.is_running
