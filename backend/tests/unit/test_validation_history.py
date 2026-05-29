"""
校验历史存储服务单元测试

测试覆盖:
- ValidationHistoryStore 初始化、添加、查询、删除
- generate_run_id 生成唯一 ID
- MAX_HISTORY_ENTRIES 上限裁剪
"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


from app.shared.services.validation.history import (
    MAX_HISTORY_ENTRIES,
    ValidationHistoryStore,
    ValidationRunRecord,
    generate_run_id,
)


def _make_record(run_id: str | None = None, pass_rate: float = 95.0) -> ValidationRunRecord:
    """构造一条校验记录"""
    return ValidationRunRecord(
        id=run_id or generate_run_id(),
        timestamp="2026-05-28T14:30:22",
        duration_ms=1234,
        scope="full",
        summary={
            "total_checks": 50,
            "passed_count": 47,
            "failed_count": 3,
            "pass_rate": pass_rate,
            "tables_loaded": 2,
            "total_error_count": 3,
        },
        by_type={"unique": {"total": 10, "passed": 9, "failed": 1}},
        by_table={"employees": {"total": 20, "passed": 18, "failed": 2}},
        errors=[
            {
                "stage": "constraint",
                "error_type": "unique",
                "check_type": "unique",
                "message": "duplicate value",
                "table": "employees",
                "column": "email",
                "row_index": 5,
                "value": "dup@test.com",
            }
        ],
        warnings=["some warning"],
    )


class TestGenerateRunId:
    def test_returns_run_prefix(self):
        """生成的 ID 以 run_ 开头"""
        rid = generate_run_id()
        assert rid.startswith("run_")

    def test_unique_across_calls(self):
        """连续调用生成不同 ID"""
        ids = {generate_run_id() for _ in range(10)}
        assert len(ids) == 10


class TestValidationHistoryStore:
    def test_add_and_get(self, tmp_path):
        """添加记录后可查询到"""
        store = ValidationHistoryStore(str(tmp_path))
        record = _make_record(run_id="run_test_001")
        store.add_run(record)

        result = store.get_run("run_test_001")
        assert result is not None
        assert result["id"] == "run_test_001"
        assert result["summary"]["pass_rate"] == 95.0

    def test_get_nonexistent_returns_none(self, tmp_path):
        """查询不存在的记录返回 None"""
        store = ValidationHistoryStore(str(tmp_path))
        assert store.get_run("nonexistent") is None

    def test_list_runs_pagination(self, tmp_path):
        """分页查询正确"""
        store = ValidationHistoryStore(str(tmp_path))
        for i in range(5):
            store.add_run(_make_record(run_id=f"run_{i}"))

        page1 = store.get_runs(limit=2, offset=0)
        assert page1["total"] == 5
        assert len(page1["items"]) == 2
        assert page1["items"][0]["id"] == "run_4"  # 最新的在前

        page3 = store.get_runs(limit=2, offset=4)
        assert len(page3["items"]) == 1

    def test_delete_run(self, tmp_path):
        """删除记录后查不到"""
        store = ValidationHistoryStore(str(tmp_path))
        store.add_run(_make_record(run_id="run_del"))

        assert store.delete_run("run_del") is True
        assert store.get_run("run_del") is None

    def test_delete_nonexistent_returns_false(self, tmp_path):
        """删除不存在的记录返回 False"""
        store = ValidationHistoryStore(str(tmp_path))
        assert store.delete_run("nope") is False

    def test_max_entries_trimming(self, tmp_path):
        """超过 MAX_HISTORY_ENTRIES 时裁剪旧记录"""
        store = ValidationHistoryStore(str(tmp_path))
        for i in range(MAX_HISTORY_ENTRIES + 10):
            store.add_run(_make_record(run_id=f"run_{i}"))

        result = store.get_runs(limit=999, offset=0)
        assert result["total"] == MAX_HISTORY_ENTRIES

    def test_persistence_across_instances(self, tmp_path):
        """重新创建 store 后数据不丢失"""
        store1 = ValidationHistoryStore(str(tmp_path))
        store1.add_run(_make_record(run_id="run_persist"))

        store2 = ValidationHistoryStore(str(tmp_path))
        result = store2.get_run("run_persist")
        assert result is not None
        assert result["id"] == "run_persist"

    def test_stats_trend(self, tmp_path):
        """聚合统计返回正确的趋势数据"""
        store = ValidationHistoryStore(str(tmp_path))
        for i in range(5):
            store.add_run(_make_record(run_id=f"run_{i}", pass_rate=80.0 + i * 2))

        stats = store.get_stats(last_n=5)
        assert stats["total_runs"] == 5
        assert len(stats["trend"]) == 5
        assert stats["latest"]["pass_rate"] == 88.0  # 最后添加的（run_4）在列表最前

    def test_corrupted_file_handled(self, tmp_path):
        """损坏的历史文件不崩溃"""
        history_dir = tmp_path / ".precis"
        history_dir.mkdir()
        history_file = history_dir / "validation_history.json"
        history_file.write_text("not valid json", encoding="utf-8")

        store = ValidationHistoryStore(str(tmp_path))
        assert store.get_runs()["total"] == 0

    def test_empty_warnings_default(self, tmp_path):
        """warnings 字段默认为空列表"""
        record = ValidationRunRecord(
            id="run_no_warn",
            timestamp="2026-01-01T00:00:00",
            duration_ms=100,
            scope="full",
            summary={"total_checks": 1, "passed_count": 1, "failed_count": 0, "pass_rate": 100.0},
            by_type={},
            by_table={},
            errors=[],
        )
        store = ValidationHistoryStore(str(tmp_path))
        store.add_run(record)

        result = store.get_run("run_no_warn")
        assert result["warnings"] == []
