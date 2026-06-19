"""
@fileoverview 校验历史存储行为测试

覆盖 add_run、get_stats、_save 异常处理。
"""

from __future__ import annotations

from unittest.mock import patch

from app.shared.services.validation.history import ValidationHistoryStore, ValidationRunRecord


class TestValidationHistoryStore:
    """ValidationHistoryStore 行为"""

    def _make_record(self):
        return ValidationRunRecord(
            id="run_1",
            timestamp="2024-01-01T00:00:00Z",
            duration_ms=100,
            scope="all",
            summary={"total": 10, "passed": 9, "failed": 1, "pass_rate": 0.9, "total_checks": 10},
            by_type={},
            by_table={},
            errors=[],
        )

    def test_add_run_persists(self, tmp_path):
        store = ValidationHistoryStore(project_dir=str(tmp_path))
        record = self._make_record()
        run_id = store.add_run(record)
        assert run_id == record.id
        assert store._file_path.exists()

    def test_get_stats(self, tmp_path):
        store = ValidationHistoryStore(project_dir=str(tmp_path))
        store.add_run(self._make_record())
        stats = store.get_stats()
        assert stats["total_runs"] == 1
        assert stats["latest"]["pass_rate"] == 0.9

    def test_save_handles_io_error(self, tmp_path):
        store = ValidationHistoryStore(project_dir=str(tmp_path))
        store.add_run(self._make_record())
        with patch("builtins.open", side_effect=OSError("disk full")):
            # 不应抛出异常
            store._save()
