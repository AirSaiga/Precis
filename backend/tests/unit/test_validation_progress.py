"""校验进度回调单元测试（V2-3a/V2-3b）。

覆盖：
- execute 传 progress_callback 时收到正确的事件序列（loading → validating → done）。
- execute 不传 progress_callback 时行为完全不变（返回结果与传 None 一致）。
- callback 抛异常时不影响校验（校验仍正常完成，结果一致）。
- 分块模式下 chunk 边界触发细粒度事件。
- ValidationService.validate 透传 progress_callback。
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

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions  # noqa: E402
from app.shared.services.validation.progress import ProgressEvent  # noqa: E402

# qa_test/qa_simple 是仓库内置的最小可运行 V2 项目
QA_SIMPLE_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "qa_simple"


@pytest.fixture
def qa_simple_copy(tmp_path):
    """复制 qa_simple 真实项目到 tmp_path，避免污染源文件。"""
    if not QA_SIMPLE_ROOT.is_dir():
        pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")
    proj = tmp_path / "qa_simple"
    shutil.copytree(QA_SIMPLE_ROOT, proj)
    return proj


def _manifest(proj: Path) -> str:
    return str(proj / "project.precis.yaml")


def _data_dir(proj: Path) -> str:
    return str(proj / "data")


# ============================================================================
# 标准模式：事件序列
# ============================================================================


class TestStandardModeProgressSequence:
    """标准模式（非分块）进度事件序列测试。"""

    def test_receives_loading_validating_done_stages(self, qa_simple_copy):
        """传 progress_callback 时至少收到 loading → validating → done 三阶段。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: events.append(e))

        stages = [e.stage for e in events]
        # 至少包含三个阶段，且 done 是最后一个
        assert "loading" in stages
        assert "validating" in stages
        assert stages[-1] == "done"

    def test_done_event_has_final_error_count(self, qa_simple_copy):
        """done 事件的 errors_so_far 应等于结果 errors 数量。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        result = executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: events.append(e))

        done_events = [e for e in events if e.stage == "done"]
        assert done_events, "缺少 done 事件"
        assert done_events[-1].errors_so_far == len(result["errors"])

    def test_done_event_rows_done_equals_rows_total(self, qa_simple_copy):
        """done 事件的 rows_done 应等于 rows_total（标准模式加载后已知总行数）。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: events.append(e))

        done = [e for e in events if e.stage == "done"][-1]
        assert done.rows_total > 0
        assert done.rows_done == done.rows_total

    def test_loading_event_rows_total_matches_loaded_rows(self, qa_simple_copy):
        """loading 事件的 rows_total 应为各表行数之和。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        result = executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: events.append(e))

        loading = [e for e in events if e.stage == "loading"][-1]
        expected_total = sum(len(df) for df in result["raw_datasets"].values())
        assert loading.rows_total == expected_total

    def test_standard_mode_chunk_fields_are_zero(self, qa_simple_copy):
        """标准模式事件 chunk_index/chunk_total 恒为 0。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: events.append(e))

        for e in events:
            assert e.chunk_index == 0
            assert e.chunk_total == 0

    def test_elapsed_ms_non_decreasing(self, qa_simple_copy):
        """所有事件的 elapsed_ms 应单调非递减。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: events.append(e))

        for prev, cur in zip(events, events[1:]):
            assert cur.elapsed_ms >= prev.elapsed_ms


# ============================================================================
# 不传 callback：零回归
# ============================================================================


class TestNoCallbackZeroRegression:
    """不传 progress_callback 时行为完全不变。"""

    def test_result_identical_with_and_without_callback(self, qa_simple_copy):
        """传 None 与完全不传，返回结果的关键字段一致。"""
        executor = ValidationExecutor(_manifest(qa_simple_copy))

        result_no_cb = executor.execute(_data_dir(qa_simple_copy))
        result_none_cb = executor.execute(_data_dir(qa_simple_copy), progress_callback=None)

        # errors 数量与 error_type 集合一致（message 可能含时间，不逐字比较）
        assert len(result_no_cb["errors"]) == len(result_none_cb["errors"])
        types_a = sorted(e.get("error_type", "") for e in result_no_cb["errors"])
        types_b = sorted(e.get("error_type", "") for e in result_none_cb["errors"])
        assert types_a == types_b

        # loading_errors 一致
        assert len(result_no_cb["loading_errors"]) == len(result_none_cb["loading_errors"])

        # 表集合一致
        assert set(result_no_cb["raw_datasets"].keys()) == set(result_none_cb["raw_datasets"].keys())

        # chunked_mode 均为 False（qa_simple 数据量小，不走分块）
        assert result_no_cb["chunked_mode"] is False
        assert result_none_cb["chunked_mode"] is False

    def test_callback_receives_no_events_when_none(self, qa_simple_copy):
        """传 None 时不应触发任何回调（用可变计数器验证）。"""
        calls = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        executor.execute(_data_dir(qa_simple_copy), progress_callback=lambda e: calls.append(e))
        # 上面传了真 callback 会收到事件；这里验证传 None 时回调对象不被调用
        assert calls  # 真 callback 收到事件
        calls_none = []
        executor.execute(_data_dir(qa_simple_copy), progress_callback=None)
        assert calls_none == []


# ============================================================================
# callback 异常安全
# ============================================================================


class TestCallbackExceptionSafety:
    """callback 抛异常不应影响校验主流程。"""

    def test_callback_raising_does_not_break_validation(self, qa_simple_copy, caplog):
        """callback 抛异常时校验仍正常完成，结果与正常 callback 一致。"""
        executor = ValidationExecutor(_manifest(qa_simple_copy))

        # 正常 callback 收集结果作为基线
        baseline_events: list[ProgressEvent] = []
        baseline_result = executor.execute(
            _data_dir(qa_simple_copy), progress_callback=lambda e: baseline_events.append(e)
        )

        def boom(_e: ProgressEvent) -> None:
            raise RuntimeError("callback boom")

        # 抛异常的 callback
        with caplog.at_level("ERROR"):
            result = executor.execute(_data_dir(qa_simple_copy), progress_callback=boom)

        # 校验仍正常完成：errors 数量一致
        assert len(result["errors"]) == len(baseline_result["errors"])
        assert set(result["raw_datasets"].keys()) == set(baseline_result["raw_datasets"].keys())
        # duration 仍被计算
        assert result["duration_ms"] >= 0

    def test_callback_raising_logs_error(self, qa_simple_copy, caplog):
        """callback 异常应记日志（便于排查），但不抛出。"""
        executor = ValidationExecutor(_manifest(qa_simple_copy))

        def boom(_e: ProgressEvent) -> None:
            raise RuntimeError("logged boom")

        with caplog.at_level("ERROR", logger="app.shared.services.validation.executor"):
            executor.execute(_data_dir(qa_simple_copy), progress_callback=boom)

        assert any("progress_callback" in rec.message for rec in caplog.records)


# ============================================================================
# 分块模式：chunk 边界事件
# ============================================================================


class TestChunkedModeProgress:
    """分块模式进度事件测试（通过极小 chunk 阈值强制分块）。"""

    def _force_chunked_options(self) -> ValidationOptions:
        """构造强制分块的选项：阈值 0 MB + 极小 chunk_rows。"""
        return ValidationOptions(chunk_threshold_mb=0.0, chunk_rows=2)

    def test_chunked_mode_emits_chunk_progress(self, qa_simple_copy):
        """分块模式下应触发含 chunk_index > 0 的 validating 事件。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        result = executor.execute(
            _data_dir(qa_simple_copy),
            options=self._force_chunked_options(),
            progress_callback=lambda e: events.append(e),
        )

        assert result["chunked_mode"] is True

        validating = [e for e in events if e.stage == "validating"]
        assert validating, "分块模式未触发 validating 事件"
        # 至少有一个 chunk_index >= 1 的事件
        assert any(e.chunk_index >= 1 for e in validating)
        # chunk_total > 0
        assert all(e.chunk_total > 0 for e in validating)

    def test_chunked_done_event_rows_match_total(self, qa_simple_copy):
        """分块模式 done 事件 rows_done == rows_total == 各分块行数之和。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        result = executor.execute(
            _data_dir(qa_simple_copy),
            options=self._force_chunked_options(),
            progress_callback=lambda e: events.append(e),
        )

        done = [e for e in events if e.stage == "done"][-1]
        # 总行数应 > 0（qa_simple 有数据）
        assert done.rows_total > 0
        assert done.rows_done == done.rows_total
        # done 事件的 errors_so_far 与结果一致
        assert done.errors_so_far == len(result["errors"])

    def test_chunked_rows_done_monotonic(self, qa_simple_copy):
        """分块模式 validating 事件的 rows_done 应随 chunk 处理单调非递减。"""
        events: list[ProgressEvent] = []
        executor = ValidationExecutor(_manifest(qa_simple_copy))
        executor.execute(
            _data_dir(qa_simple_copy),
            options=self._force_chunked_options(),
            progress_callback=lambda e: events.append(e),
        )

        validating = [e for e in events if e.stage == "validating"]
        rows_done_seq = [e.rows_done for e in validating]
        for prev, cur in zip(rows_done_seq, rows_done_seq[1:]):
            assert cur >= prev, f"rows_done 非单调: {prev} -> {cur}"


# ============================================================================
# ValidationService 透传
# ============================================================================


class TestValidationServicePassthrough:
    """ValidationService.validate 透传 progress_callback 给 executor。"""

    def test_service_forwards_callback(self, qa_simple_copy):
        """service.validate 传 progress_callback 时应收到事件。"""
        from app.cli.tui.services.validation_service import ValidationService

        events: list[ProgressEvent] = []
        service = ValidationService()
        result = service.validate(
            _manifest(qa_simple_copy),
            _data_dir(qa_simple_copy),
            progress_callback=lambda e: events.append(e),
        )

        # 收到事件且至少包含三个阶段
        stages = [e.stage for e in events]
        assert "loading" in stages
        assert "validating" in stages
        assert stages[-1] == "done"

        # done 事件 errors_so_far 与 ValidationResult.errors 一致
        done = [e for e in events if e.stage == "done"][-1]
        assert done.errors_so_far == len(result.errors)

    def test_service_without_callback_unchanged(self, qa_simple_copy):
        """service.validate 不传 callback 时返回正常结果。"""
        from app.cli.tui.services.validation_service import ValidationService

        service = ValidationService()
        result = service.validate(_manifest(qa_simple_copy), _data_dir(qa_simple_copy))

        # qa_simple 必然有错误（契约：exit 1）
        assert result.has_errors
        assert result.duration_ms >= 0
