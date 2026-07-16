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

    def test_save_is_atomic_no_partial_overwrite(self, tmp_path):
        """回归 C7: _save 必须原子写入(tmp + os.replace),不能直接覆写目标文件。

        原实现直接以 "w" 打开目标文件写入,写一半(json.dump 中途)崩溃会留下截断损坏的
        JSON,后续 _load 失败 → self._runs=[] → 下次保存永久清空全部历史。
        要求:若写入中途失败,目标文件必须保持旧内容完整(原子替换语义)。
        """
        import json

        store = ValidationHistoryStore(project_dir=str(tmp_path))
        store.add_run(self._make_record())  # 旧内容:run_1
        old_content = store._file_path.read_text(encoding="utf-8")

        # 让 json.dump 在写入中途抛异常(模拟写一半崩溃)。直接 open("w") 会先清空文件,
        # 此时若 dump 失败 → 文件被截断破坏;原子写(tmp+replace)则不受影响。
        with patch("app.shared.services.validation.history.json.dump", side_effect=OSError("写一半崩溃")):
            store._save()

        # 关键:目标文件应保持完整的旧内容,未被部分写入破坏
        current = store._file_path.read_text(encoding="utf-8")
        assert current == old_content, "写入失败时目标文件应保持旧内容完整(原子写),实际被破坏/截断"
        # 旧内容仍可正常解析
        json.loads(current)

    def test_corrupted_load_does_not_silently_wipe_existing(self, tmp_path):
        """回归 C7: 损坏的 history 文件加载失败时,不应静默清空后用空列表覆写(否则下次
        add_run 会永久丢失全部历史)。

        要求:加载损坏文件时,内存列表为空(无法解析),但损坏文件应被备份(.corrupted)
        保留现场,而非被静默删除/清空——便于用户手工恢复/排查。
        """
        hist_dir = tmp_path / ".precis"
        hist_dir.mkdir()
        hist_file = hist_dir / "validation_history.json"
        corrupted_content = "{这是无效 JSON"
        hist_file.write_text(corrupted_content, encoding="utf-8")

        # 构造 store 不应抛异常
        store = ValidationHistoryStore(project_dir=str(tmp_path))
        assert store._runs == []  # 无法解析,内存为空

        # 损坏内容应被备份保留(而非静默丢弃/清空)
        backup_files = list(hist_dir.glob("*.corrupted"))
        assert len(backup_files) == 1, f"损坏文件应备份为 .corrupted,实际: {backup_files}"
        assert backup_files[0].read_text(encoding="utf-8") == corrupted_content, "备份应保留原始损坏内容"

        # 后续 add_run 不会丢失:新内容写到正式文件,备份仍在
        store.add_run(self._make_record())
        assert hist_file.exists()
        assert backup_files[0].exists(), "备份文件不应被后续保存删除"
