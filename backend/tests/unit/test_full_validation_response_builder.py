"""
@fileoverview 全量校验响应构建器单元测试

测试 FullValidationResponseBuilder 对 executor 结果的转换逻辑，
包括错误分类、通过项构造、ID -> Name 映射、统计聚合与异常响应。
"""

import time
from types import SimpleNamespace

from app.api.services.full_validation_response_builder import FullValidationResponseBuilder


def _make_schema(schema_id: str, name: str | None = None):
    """构造一个最小可用的 Schema 模拟对象。"""
    return SimpleNamespace(id=schema_id, name=name)


def _make_executor(tables: dict | None = None):
    """构造一个 ValidationExecutor 模拟对象。"""
    dataset_schema = SimpleNamespace(tables=tables or {})
    return SimpleNamespace(dataset_schema=dataset_schema)


def _make_result(**overrides):
    """构造一个默认的 executor 结果字典，可被覆盖。"""
    defaults = {
        "raw_datasets": {},
        "loading_errors": [],
        "errors": [],
        "validation_details": {"format_checks": [], "constraint_checks": []},
        "duration_ms": 100,
        "warnings": [],
    }
    defaults.update(overrides)
    return defaults


class TestBuildFromResult:
    def test_success_response_without_errors(self):
        executor = _make_executor({"users": _make_schema("users", "Users")})
        result = _make_result(
            raw_datasets={"users": {"source_file": "users.csv", "source_sheet": None}},
            validation_details={
                "format_checks": [{"table": "users", "passed": True}],
                "constraint_checks": [
                    {
                        "constraint_type": "NotNull",
                        "table": "users",
                        "description": "",
                        "passed": True,
                    }
                ],
            },
            warnings=["一个警告"],
        )
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert resp.success is True
        assert resp.summary.files_total == 1
        assert resp.summary.files_loaded == 1
        assert resp.summary.tables_loaded == 1
        assert resp.summary.total_error_count == 0
        assert len(resp.passed_items) == 3
        assert resp.passed_items[0].stage == "loading"
        assert resp.passed_items[0].table == "Users"
        assert resp.statistics.total_checks == 3
        assert resp.statistics.passed_count == 3
        assert resp.statistics.failed_count == 0
        assert resp.statistics.pass_rate == 100.0
        assert resp.warnings == ["一个警告"]
        assert resp.error is None

    def test_id_to_name_mapping_uses_schema_name(self):
        executor = _make_executor({"u1": _make_schema("u1", "用户表")})
        result = _make_result(
            raw_datasets={"u1": {"source_file": "u1.csv"}},
        )
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert resp.passed_items[0].table == "用户表"
        assert resp.passed_items[0].message == "数据表 '用户表' 加载成功"

    def test_loading_error_is_classified(self):
        executor = _make_executor()
        result = _make_result(
            loading_errors=[
                {
                    "error_type": "FileNotFound",
                    "message": "找不到文件",
                    "suggestion": "检查路径",
                    "file_path": "/data/missing.csv",
                    "source_file": "missing.csv",
                    "source_sheet": None,
                }
            ],
        )
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert resp.success is False
        assert len(resp.errors) == 1
        assert resp.errors[0].stage == "loading"
        assert resp.errors[0].error_type == "FileNotFound"
        assert "建议: 检查路径" in resp.errors[0].message
        assert resp.summary.loading_error_count == 1
        assert resp.summary.total_error_count == 1
        assert resp.statistics.failed_count == 1
        assert resp.statistics.by_type.get("DataLoad", {}).get("failed") == 1

    def test_constraint_error_is_classified(self):
        executor = _make_executor({"users": _make_schema("users", "Users")})
        result = _make_result(
            raw_datasets={"users": {"source_file": "users.csv"}},
            errors=[
                {
                    "stage": "constraint",
                    "error_type": "NotNullViolation",
                    "check_type": "NotNull",
                    "message": "列 email 存在空值",
                    "table": "users",
                    "table_id": "users",
                    "column": "email",
                    "column_id": "email",
                    "row_index": 5,
                    "value": "",
                }
            ],
        )
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert resp.success is False
        assert len(resp.errors) == 1
        assert resp.errors[0].stage == "constraint"
        assert resp.errors[0].check_type == "NotNull"
        assert resp.errors[0].row_index == 5
        assert resp.summary.constraint_error_count == 1
        assert resp.statistics.by_type.get("NotNull", {}).get("failed") == 1
        assert resp.statistics.by_table.get("users", {}).get("failed") == 1

    def test_duplicate_timeout_errors_are_deduplicated(self):
        executor = _make_executor()
        result = _make_result(
            errors=[
                {"error_type": "Timeout", "message": "超时1"},
                {"error_type": "Timeout", "message": "超时2"},
            ],
        )
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert len(resp.errors) == 1
        assert resp.errors[0].error_type == "Timeout"

    def test_statistics_aggregate_by_type_and_table(self):
        executor = _make_executor({"users": _make_schema("users", "Users")})
        result = _make_result(
            raw_datasets={"users": {"source_file": "users.csv"}},
            validation_details={
                "format_checks": [{"table": "users", "passed": True}],
                "constraint_checks": [
                    {
                        "constraint_type": "Unique",
                        "table": "users",
                        "description": "",
                        "passed": True,
                    }
                ],
            },
            errors=[
                {
                    "stage": "constraint",
                    "error_type": "NotNullViolation",
                    "check_type": "NotNull",
                    "message": "空值",
                    "table": "users",
                }
            ],
        )
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert resp.statistics.total_checks == 4
        assert resp.statistics.passed_count == 3
        assert resp.statistics.failed_count == 1
        assert resp.statistics.by_type["DataLoad"]["passed"] == 1
        assert resp.statistics.by_type["FormatValidation"]["passed"] == 1
        assert resp.statistics.by_type["Unique"]["passed"] == 1
        assert resp.statistics.by_type["NotNull"]["failed"] == 1
        # 加载通过项使用 Schema 显示名；格式/约束通过项使用原始表名，因此分别统计
        assert resp.statistics.by_table["Users"]["total"] == 1
        assert resp.statistics.by_table["Users"]["passed"] == 1
        assert resp.statistics.by_table["users"]["total"] == 3
        assert resp.statistics.by_table["users"]["passed"] == 2
        assert resp.statistics.by_table["users"]["failed"] == 1


class TestBuildError:
    def test_error_response_contains_fatal_message(self):
        builder = FullValidationResponseBuilder(
            executor=None,
            started=time.monotonic() - 0.05,
        )

        resp = builder.build_error(ValueError("初始化失败"), files_total=3)

        assert resp.success is False
        assert resp.error == "初始化失败"
        assert resp.summary.files_total == 3
        assert resp.summary.files_loaded == 0
        assert resp.summary.total_error_count == 0
        assert resp.errors == []
        assert resp.passed_items == []
        assert resp.statistics.total_checks == 0
        assert resp.statistics.pass_rate == 100.0
        assert resp.summary.duration_ms >= 0


class TestEdgeCases:
    def test_empty_result_has_zero_checks_and_full_pass_rate(self):
        executor = _make_executor()
        builder = FullValidationResponseBuilder(executor, started=time.monotonic())

        resp = builder.build_from_result(_make_result())

        assert resp.success is True
        assert resp.summary.total_error_count == 0
        assert resp.passed_items == []
        assert resp.statistics.total_checks == 0
        assert resp.statistics.pass_rate == 100.0
        assert resp.statistics.by_type == {}

    def test_no_executor_builds_empty_id_to_name(self):
        result = _make_result(
            raw_datasets={"t1": {"source_file": "t1.csv"}},
        )
        builder = FullValidationResponseBuilder(executor=None, started=time.monotonic())

        resp = builder.build_from_result(result)

        assert resp.passed_items[0].table == "t1"
