"""
@fileoverview ValidationExecutor load_data_sources / execute 单元测试

通过 mock 覆盖复杂执行路径。
"""

from unittest.mock import MagicMock, patch

import pandas as pd

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


class MockTableSchema:
    def __init__(self, name="users", id=None):
        self.name = name
        self.id = id or name


class MockSchemaFile:
    def __init__(self, name="users", id="users", source=None, sheet=None):
        self.name = name
        self.id = id
        self.source = source
        self.sheet = sheet


class MockManifest:
    def __init__(self):
        self.data_sources = []
        self.settings = MagicMock()
        self.settings.validation = MagicMock()
        self.settings.validation.timeout_seconds = 30
        self.settings.validation.error_handling = "continue"
        self.settings.file_processing = MagicMock()
        self.settings.file_processing.default_encoding = "utf-8"
        self.settings.file_processing.csv_delimiter = ","
        self.settings.script_security = MagicMock()


class MockDatasetSchema:
    def __init__(self, tables=None, constraints=None):
        self.tables = tables or {}
        self.constraints = constraints or []


class MockLoadedProject:
    def __init__(self, tables=None, constraints=None, schema_files=None):
        self.manifest = MockManifest()
        self.dataset_schema = MockDatasetSchema(tables, constraints)
        self.schema_files = schema_files or {}
        self.constraint_files = {}
        self.regex_node_files = {}
        self.warnings = []
        self.loading_errors = []


def _make_executor(tables=None, constraints=None, schema_files=None):
    with (
        patch("app.shared.services.validation.executor.load_project") as mock_load,
        patch("os.path.exists", return_value=True),
    ):
        lp = MockLoadedProject(tables, constraints, schema_files)
        mock_load.return_value = lp
        executor = ValidationExecutor("D:\\project\\project.precis.yaml")
        executor.project_root = "D:\\project"
        return executor


class TestLoadDataSources:
    def test_empty(self):
        executor = _make_executor()
        with patch("os.path.isdir", return_value=True):
            raw, errors = executor._data_loader.load_data_sources("D:\\data")
        assert raw == {}
        assert errors == []

    def test_directory_not_found(self):
        executor = _make_executor()
        with patch("os.path.isdir", return_value=False):
            raw, errors = executor._data_loader.load_data_sources("D:\\nonexistent")
        assert raw == {}
        assert any(e["error_type"] == "DirectoryNotFound" for e in errors)

    def test_table_filter_string(self):
        executor = _make_executor(
            tables={"users": MockTableSchema("users")}, schema_files={"users": MockSchemaFile("users", "users")}
        )
        with (
            patch("os.path.isdir", return_value=True),
            patch.object(executor._resolver, "resolve_source_path", return_value=("D:\\data\\users.csv", None)),
            patch(
                "app.shared.services.validation.data_loader.load_grouped_sources",
                return_value=({"users": pd.DataFrame()}, []),
            ),
        ):
            raw, errors = executor._data_loader.load_data_sources("D:\\data", table_filter="users")
        assert "users" in raw
        assert errors == []

    def test_table_filter_list(self):
        executor = _make_executor(
            tables={"users": MockTableSchema("users"), "orders": MockTableSchema("orders")},
            schema_files={"users": MockSchemaFile("users", "users"), "orders": MockSchemaFile("orders", "orders")},
        )
        with (
            patch("os.path.isdir", return_value=True),
            patch.object(executor._resolver, "resolve_source_path", return_value=("D:\\data\\users.csv", None)),
            patch(
                "app.shared.services.validation.data_loader.load_grouped_sources",
                return_value=({"users": pd.DataFrame()}, []),
            ),
        ):
            raw, errors = executor._data_loader.load_data_sources("D:\\data", table_filter=["users"])
        assert "users" in raw
        assert "orders" not in raw

    def test_source_not_found(self):
        executor = _make_executor(
            tables={"users": MockTableSchema("users")}, schema_files={"users": MockSchemaFile("users", "users")}
        )
        with (
            patch("os.path.isdir", return_value=True),
            patch.object(executor._resolver, "resolve_source_path", return_value=(None, None)),
        ):
            raw, errors = executor._data_loader.load_data_sources("D:\\data")
        assert raw == {}
        assert any(e["error_type"] == "SourceNotFound" for e in errors)

    def test_fk_table_auto_load(self):
        fk_constraint = MagicMock()
        fk_constraint.table = "users"
        fk_constraint.to_table = "orders"
        executor = _make_executor(
            tables={"users": MockTableSchema("users"), "orders": MockTableSchema("orders")},
            constraints=[fk_constraint],
            schema_files={"users": MockSchemaFile("users", "users"), "orders": MockSchemaFile("orders", "orders")},
        )
        with (
            patch("os.path.isdir", return_value=True),
            patch.object(executor._resolver, "resolve_source_path", return_value=("D:\\data\\file.csv", None)),
            patch(
                "app.shared.services.validation.data_loader.load_grouped_sources",
                return_value=({"users": pd.DataFrame(), "orders": pd.DataFrame()}, []),
            ),
        ):
            raw, errors = executor._data_loader.load_data_sources("D:\\data", table_filter="users")
        assert "users" in raw
        assert "orders" in raw


class TestExecute:
    def test_basic(self):
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame({"a": [1]})}, [], {"users": []}),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())
        assert "raw_datasets" in result
        assert "parsed_datasets" in result
        assert "errors" in result
        assert "duration_ms" in result
        assert result["timeout_occurred"] is False

    def test_no_data(self):
        executor = _make_executor()
        with patch.object(executor._data_loader, "load_data_sources", return_value=({}, [])):
            result = executor.execute("D:\\data", ValidationOptions())
        assert any(e.get("error_type") == "DataLoadingError" for e in result["errors"])

    def test_stop_on_first_error_sets_interrupted(self):
        """C6: error_handling='stop' 且校验返回 ValidationInterrupted 标记时,
        result['interrupted'] 应为 True。"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        interrupted_errors = [
            {"error_type": "NotNullViolation", "table": "users", "column": "id", "message": "空值"},
            {"error_type": "ValidationInterrupted", "stage": "constraint", "message": "遇错即停"},
        ]
        with (
            patch.object(
                executor._data_loader,
                "load_data_sources",
                return_value=({"users": pd.DataFrame({"id": [1, None]})}, []),
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=(
                    {"users": pd.DataFrame({"id": [1, None]})},
                    interrupted_errors,
                    {"format_checks": [], "constraint_checks": []},
                ),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions(error_handling="stop"))
        assert result["interrupted"] is True, "error_handling=stop 且有中断标记时 interrupted 应为 True"

    def test_continue_mode_no_interrupted(self):
        """C6: 默认 error_handling='continue' 时,interrupted 应为 False(即使有错误)。"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        with (
            patch.object(
                executor._data_loader,
                "load_data_sources",
                return_value=({"users": pd.DataFrame({"id": [1, None]})}, []),
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=(
                    {"users": pd.DataFrame({"id": [1, None]})},
                    [{"error_type": "NotNullViolation", "table": "users", "message": "空值"}],
                    {"format_checks": [], "constraint_checks": []},
                ),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())  # 默认 continue
        assert result["interrupted"] is False
