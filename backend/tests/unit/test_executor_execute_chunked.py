"""
@fileoverview ValidationExecutor _execute_chunked 方法单元测试

覆盖分块校验主流程：正常分块执行、超时、异常处理、结果合并、
后处理等路径。_execute_chunked 是 execute 中最大的未覆盖块（~155行）。
"""

import os
import sys
import time

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock, patch

import pandas as pd

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


class MockSource:
    def __init__(self, path="data.csv", sheet=None):
        self.path = path
        self.sheet = sheet


class MockSchemaFile:
    def __init__(self, name="users", id="users", source=None, sheet=None):
        self.name = name
        self.id = id
        self.source = source
        self.sheet = sheet


class MockTableSchema:
    def __init__(self, name="users", id="users"):
        self.name = name
        self.id = id or name


class MockDatasetSchema:
    def __init__(self, tables=None):
        self.tables = tables or {}


def _make_minimal_executor():
    """创建最小 executor（绕过 __init__ 文件检查）"""
    executor = ValidationExecutor.__new__(ValidationExecutor)
    executor.project_root = "D:\\project"
    executor.loaded_project = MagicMock()
    executor.loaded_project.loading_errors = []
    executor.loaded_project.warnings = []
    executor.dataset_schema = MockDatasetSchema()
    executor.settings = MagicMock()
    executor.manifest = MagicMock()
    executor._schema_by_id = {}
    executor._resolver = MagicMock()
    executor._data_loader = MagicMock()
    executor._memory_monitor = MagicMock()
    executor._memory_monitor.get_progress_info.return_value = {}
    executor._chunked_loader = None
    return executor


def _make_result_dict(with_chunked=False):
    return {
        "raw_datasets": {},
        "parsed_datasets": {},
        "errors": [],
        "loading_errors": [],
        "duration_ms": 0,
        "timeout_occurred": False,
        "validation_details": {"format_checks": [], "constraint_checks": []},
        "chunked_mode": with_chunked,
        "memory_info": {},
    }


class TestExecuteChunked:
    def test_basic_chunked_execution(self):
        """基本分块校验流程：正常加载并校验多个分块"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_datasets = {
            "users": [
                pd.DataFrame({"a": [1, 2]}),
                pd.DataFrame({"a": [3, 4]}),
            ]
        }
        chunked_loader.load_chunked_sources.return_value = chunked_datasets
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        started = time.monotonic()
        with patch(
            "app.shared.services.validation.executor.validate_full_dataset",
            return_value=(
                {"users": pd.DataFrame({"a": [5, 6]})},
                [{"error_type": "TestError", "message": "test"}],
                {"format_checks": [{"check": "fmt"}], "constraint_checks": [{"check": "con"}]},
            ),
        ):
            result = executor._execute_chunked(
                "D:\\data", ValidationOptions(timeout_seconds=300), started, _make_result_dict()
            )

        assert len(result["errors"]) == 2  # 2 chunks, each produces 1 error
        assert result["validation_details"]["format_checks"] == [{"check": "fmt"}, {"check": "fmt"}]
        assert result["validation_details"]["constraint_checks"] == [{"check": "con"}, {"check": "con"}]
        assert "users" in result["parsed_datasets"]
        # Each chunk's validate returns a 2-row df, concat gives 4 rows
        assert len(result["parsed_datasets"]["users"]) == 4

    def test_chunked_load_failure(self):
        """分块加载失败时返回错误"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.side_effect = RuntimeError("load failed")
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        started = time.monotonic()
        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), started, _make_result_dict()
        )
        assert any(e["error_type"] == "ChunkedLoadError" for e in result["errors"])
        assert result["duration_ms"] >= 0

    def test_chunked_no_datasets(self):
        """分块加载返回空数据集"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {}
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        started = time.monotonic()
        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), started, _make_result_dict()
        )
        assert any(e["error_type"] == "DataLoadingError" for e in result["errors"])

    def test_chunked_timeout_during_loading_check(self):
        """加载阶段超时检查"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {"t1": [pd.DataFrame({"a": [1]})]}
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)

        started = -100.0  # started far in the past
        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=1), started, _make_result_dict()
        )
        assert result["timeout_occurred"] is True
        assert any(e["error_type"] == "Timeout" for e in result["errors"])

    def test_chunk_timeout_mid_processing(self):
        """处理过程中分块超时"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_datasets = {"t1": [pd.DataFrame({"a": [1]}), pd.DataFrame({"a": [2]})]}
        chunked_loader.load_chunked_sources.return_value = chunked_datasets
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)
        executor.dataset_schema = MockDatasetSchema(tables={"t1": MockTableSchema("t1", "t1")})
        executor._schema_by_id = {"t1": MockSchemaFile("t1", "t1")}
        executor.loaded_project.loading_errors = []
        executor.loaded_project.warnings = []

        # Make loading fast but trigger timeout during chunk processing
        with (
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"t1": pd.DataFrame({"a": [1]})}, [], {}),
            ),
        ):
            # Use started very far in the past so timeout triggers
            result = executor._execute_chunked(
                "D:\\data", ValidationOptions(timeout_seconds=1), -100.0, _make_result_dict()
            )
        assert result["timeout_occurred"] is True

    def test_chunk_validation_exception(self):
        """单个分块校验异常时记录错误并继续"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_datasets = {"t1": [pd.DataFrame({"a": [1]}), pd.DataFrame({"a": [2]})]}
        chunked_loader.load_chunked_sources.return_value = chunked_datasets
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)
        executor.dataset_schema = MockDatasetSchema(tables={"t1": MockTableSchema("t1", "t1")})
        executor._schema_by_id = {"t1": MockSchemaFile("t1", "t1")}
        executor.loaded_project.loading_errors = []
        executor.loaded_project.warnings = []

        validate_calls = [0]

        def validate_side_effect(*args, **kwargs):
            validate_calls[0] += 1
            if validate_calls[0] == 1:
                raise RuntimeError("chunk error")
            return ({"t1": pd.DataFrame({"a": [10]})}, [], {})

        started = time.monotonic()
        with patch("app.shared.services.validation.executor.validate_full_dataset", side_effect=validate_side_effect):
            result = executor._execute_chunked(
                "D:\\data", ValidationOptions(timeout_seconds=300), started, _make_result_dict()
            )
        assert any(e["error_type"] == "ChunkValidationError" for e in result["errors"])
        # Second chunk should still succeed
        assert "t1" in result["parsed_datasets"]

    def test_chunked_loading_errors_appended(self):
        """项目加载阶段的错误追加到结果"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {"t1": [pd.DataFrame({"a": [1]})]}
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)
        executor.loaded_project.loading_errors = [
            MagicMock(to_dict=MagicMock(return_value={"error_type": "LoadError", "message": "proj load err"}))
        ]
        executor.loaded_project.warnings = ["warning1"]

        started = time.monotonic()
        result = executor._execute_chunked(
            "D:\\data", ValidationOptions(timeout_seconds=300), started, _make_result_dict()
        )
        assert len(result["loading_errors"]) == 1
        assert result["warnings"] == ["warning1"]

    def test_chunked_post_processing(self):
        """分块结果后处理（id_to_name + source_info）"""
        executor = _make_minimal_executor()
        chunked_loader = MagicMock()
        chunked_loader.load_chunked_sources.return_value = {"t1": [pd.DataFrame({"a": [1]})]}
        executor._get_chunked_loader = MagicMock(return_value=chunked_loader)
        executor.loaded_project.loading_errors = []
        executor.loaded_project.warnings = []
        executor.dataset_schema = MockDatasetSchema(tables={"t1": MockTableSchema(name="users", id="t1")})
        executor._schema_by_id = {"t1": MockSchemaFile(name="users", id="t1", source=MockSource("data.csv"))}

        started = time.monotonic()
        with patch(
            "app.shared.services.validation.executor.validate_full_dataset",
            return_value=(
                {"t1": pd.DataFrame({"a": [1]})},
                # Use table_id for source_info lookup, table for id_to_name mapping
                [{"table": "t1", "table_id": "t1", "error_type": "Test"}],
                {"format_checks": [{"table": "t1"}], "constraint_checks": [{"table": "t1"}]},
            ),
        ):
            result = executor._execute_chunked(
                "D:\\data", ValidationOptions(timeout_seconds=300), started, _make_result_dict()
            )
        # table field mapped from "t1" to "users"
        assert result["errors"][0]["table"] == "users"
        # source_info attached using table_id field (which is still "t1" and in map)
        assert result["errors"][0]["source_file"] == "data.csv"
