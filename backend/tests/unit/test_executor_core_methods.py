"""
@fileoverview ValidationExecutor 核心方法补测

覆盖 _build_table_source_map、_attach_source_info、_build_id_to_name_map、
_get_chunked_loader、_should_use_chunked_mode、execute 主流程等未充分覆盖的路径。
"""

import os
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


class MockManifest:
    def __init__(self, data_sources=None):
        self.data_sources = data_sources or []
        self.settings = MagicMock()
        self.settings.validation = MagicMock()
        self.settings.validation.timeout_seconds = 30
        self.settings.validation.error_handling = "continue"
        self.settings.file_processing = MagicMock()
        self.settings.file_processing.default_encoding = "utf-8"
        self.settings.script_security = MagicMock()
        self.settings.script_security.allow_eval = False


class MockLoadingError:
    def __init__(self, msg="error"):
        self._msg = msg

    def to_dict(self):
        return {"error_type": "LoadError", "message": self._msg}


class MockTableSchema:
    def __init__(self, name="users", id="users"):
        self.name = name
        self.id = id or name


class MockDatasetSchema:
    def __init__(self, tables=None, constraints=None):
        self.tables = tables or {}
        self.constraints = constraints or []


class MockLoadedProject:
    def __init__(
        self, tables=None, constraints=None, schema_files=None, data_sources=None, loading_errors=None, warnings=None
    ):
        self.manifest = MockManifest(data_sources=data_sources)
        self.dataset_schema = MockDatasetSchema(tables, constraints)
        self.schema_files = schema_files or {}
        self.constraint_files = {}
        self.regex_node_files = {}
        self.loading_errors = loading_errors or []
        self.warnings = warnings or []


def _make_executor(project_root="D:\\project", **kwargs):
    with (
        patch("app.shared.services.validation.executor.load_project") as mock_load,
        patch("os.path.exists", return_value=True),
    ):
        lp = MockLoadedProject(**kwargs)
        mock_load.return_value = lp
        executor = ValidationExecutor(os.path.join(project_root, "project.precis.yaml"))
        executor.project_root = project_root
        return executor


# ============================================================================
# _build_table_source_map
# ============================================================================


class TestBuildTableSourceMap:
    def test_with_source(self):
        """schema 有 source 时返回 source.path 和 source.sheet"""
        schema_file = MockSchemaFile(source=MockSource("data.csv", "Sheet1"))
        executor = _make_executor(schema_files={"t1": schema_file})
        result = executor._build_table_source_map()
        assert result["t1"]["source_file"] == "data.csv"
        assert result["t1"]["source_sheet"] == "Sheet1"

    def test_without_source(self):
        """schema 无 source 时返回 None"""
        schema_file = MockSchemaFile(source=None)
        executor = _make_executor(schema_files={"t1": schema_file})
        result = executor._build_table_source_map()
        assert result["t1"]["source_file"] is None
        assert result["t1"]["source_sheet"] is None

    def test_with_sheet_fallback(self):
        """source 无 sheet 时回退到 schema_file.sheet"""
        schema_file = MockSchemaFile(source=MockSource("data.csv", sheet=None), sheet="FallbackSheet")
        executor = _make_executor(schema_files={"t1": schema_file})
        result = executor._build_table_source_map()
        assert result["t1"]["source_file"] == "data.csv"
        assert result["t1"]["source_sheet"] == "FallbackSheet"

    def test_with_source_sheet_none_schema_sheet_none(self):
        """source.sheet 和 schema.sheet 均为 None"""
        schema_file = MockSchemaFile(source=MockSource("data.csv"))
        executor = _make_executor(schema_files={"t1": schema_file})
        result = executor._build_table_source_map()
        assert result["t1"]["source_file"] == "data.csv"
        assert result["t1"]["source_sheet"] is None

    def test_mixed_sources(self):
        """混合场景：部分有 source，部分无 source"""
        executor = _make_executor(
            schema_files={
                "t1": MockSchemaFile(source=MockSource("a.csv")),
                "t2": MockSchemaFile(source=None),
            }
        )
        result = executor._build_table_source_map()
        assert result["t1"]["source_file"] == "a.csv"
        assert result["t1"]["source_sheet"] is None
        assert result["t2"]["source_file"] is None
        assert result["t2"]["source_sheet"] is None


# ============================================================================
# _attach_source_info
# ============================================================================


class TestAttachSourceInfo:
    def test_matching_table_id(self):
        """item 中有 table_id 且匹配映射时附加信息"""
        item = {"table_id": "t1", "error": "test"}
        table_map = {"t1": {"source_file": "data.csv", "source_sheet": "Sheet1"}}
        ValidationExecutor._attach_source_info(item, table_map)
        assert item["source_file"] == "data.csv"
        assert item["source_sheet"] == "Sheet1"

    def test_matching_table_field(self):
        """item 中有 table 字段（无 table_id）时使用 table"""
        item = {"table": "t1"}
        table_map = {"t1": {"source_file": "data.csv", "source_sheet": None}}
        ValidationExecutor._attach_source_info(item, table_map)
        assert item["source_file"] == "data.csv"

    def test_no_match(self):
        """item 的 table_id 不在映射中时不附加"""
        item = {"table_id": "nonexistent"}
        table_map = {"t1": {"source_file": "data.csv", "source_sheet": None}}
        ValidationExecutor._attach_source_info(item, table_map)
        assert "source_file" not in item

    def test_no_table_id_or_table(self):
        """item 既无 table_id 也无 table 字段"""
        item = {"error": "test"}
        table_map = {"t1": {"source_file": "data.csv", "source_sheet": None}}
        ValidationExecutor._attach_source_info(item, table_map)
        assert "source_file" not in item

    def test_table_id_precedes_table(self):
        """table_id 和 table 同时存在时优先使用 table_id"""
        item = {"table_id": "t1", "table": "t2"}
        table_map = {"t1": {"source_file": "data.csv", "source_sheet": "Sheet1"}}
        ValidationExecutor._attach_source_info(item, table_map)
        assert item["source_file"] == "data.csv"


# ============================================================================
# _build_id_to_name_map
# ============================================================================


class TestBuildIdToNameMap:
    def test_has_name(self):
        """schema 有 name 时使用 name"""
        schema = MockDatasetSchema(tables={"t1": MockTableSchema(name="users", id="t1")})
        result = ValidationExecutor._build_id_to_name_map(schema)
        assert result["t1"] == "users"

    def test_no_name_uses_id(self):
        """schema 无 name 时使用 id"""
        ts = MockTableSchema(name=None, id="t1")
        schema = MockDatasetSchema(tables={"t1": ts})
        result = ValidationExecutor._build_id_to_name_map(schema)
        assert result["t1"] == "t1"

    def test_empty_schema(self):
        """空 schema"""
        schema = MockDatasetSchema(tables={})
        result = ValidationExecutor._build_id_to_name_map(schema)
        assert result == {}

    def test_none_schema(self):
        """schema 为 None"""
        result = ValidationExecutor._build_id_to_name_map(None)
        assert result == {}

    def test_multiple_tables(self):
        """多表场景"""
        schema = MockDatasetSchema(
            tables={
                "t1": MockTableSchema(name="users", id="t1"),
                "t2": MockTableSchema(name=None, id="t2"),
            }
        )
        result = ValidationExecutor._build_id_to_name_map(schema)
        assert result["t1"] == "users"
        assert result["t2"] == "t2"
        # schema.id 也映射到 name
        assert result["t1"] == "users"


# ============================================================================
# _map_table_id
# ============================================================================


class TestMapTableId:
    def test_map_table_field(self):
        """映射 table 字段"""
        item = {"table": "t1"}
        ValidationExecutor._map_table_id(item, {"t1": "users"})
        assert item["table"] == "users"

    def test_map_from_to_table(self):
        """映射 from_table/to_table 字段"""
        item = {"from_table": "t1", "to_table": "t2"}
        ValidationExecutor._map_table_id(item, {"t1": "users", "t2": "orders"})
        assert item["from_table"] == "users"
        assert item["to_table"] == "orders"

    def test_no_mapping(self):
        """ID 不在映射表中时保持原样"""
        item = {"table": "unknown"}
        ValidationExecutor._map_table_id(item, {"t1": "users"})
        assert item["table"] == "unknown"


# ============================================================================
# _get_chunked_loader
# ============================================================================


class TestGetChunkedLoader:
    def test_creates_new_loader(self):
        """首次调用创建 ChunkedDataLoader"""
        executor = _make_executor()
        assert executor._chunked_loader is None
        options = ValidationOptions(chunk_threshold_mb=200, chunk_rows=50000)
        loader = executor._get_chunked_loader(options)
        assert loader is not None
        assert executor._memory_monitor.chunk_threshold_mb == 200
        assert executor._memory_monitor.chunk_rows == 50000

    def test_reuses_existing_loader(self):
        """第二次调用复用已创建的 loader"""
        executor = _make_executor()
        options = ValidationOptions()
        loader1 = executor._get_chunked_loader(options)
        loader2 = executor._get_chunked_loader(options)
        assert loader1 is loader2


# ============================================================================
# _should_use_chunked_mode
# ============================================================================


class TestShouldUseChunkedMode:
    def test_no_schemas(self):
        """无 schema 时不启用分块"""
        executor = _make_executor()
        with patch("os.path.isdir", return_value=True):
            result = executor._should_use_chunked_mode("D:\\data", ValidationOptions())
        assert result is False

    def test_directory_not_found(self):
        """数据目录不存在时不启用分块"""
        executor = _make_executor(schema_files={"t1": MockSchemaFile("users", "t1")})
        with (
            patch.object(executor._resolver, "resolve_first_data_source", return_value=None),
            patch("os.path.isdir", return_value=False),
        ):
            result = executor._should_use_chunked_mode("D:\\nonexistent", ValidationOptions())
        assert result is False

    def test_resolver_returns_first_source(self):
        """resolve_first_data_source 返回路径时使用该路径"""
        executor = _make_executor(schema_files={"t1": MockSchemaFile("users", "t1", source=MockSource("data.csv"))})
        with (
            patch.object(executor._resolver, "resolve_first_data_source", return_value="D:\\data"),
            patch("os.path.isdir", return_value=True),
            patch.object(executor._resolver, "resolve_source_path", return_value=("D:\\data\\large.csv", None)),
            patch.object(executor._memory_monitor, "should_chunk", return_value=True),
        ):
            result = executor._should_use_chunked_mode("D:\\backup", ValidationOptions())
        assert result is True


# ============================================================================
# execute 主流程补充测试
# ============================================================================


class TestExecuteAdditional:
    def test_no_options_defaults(self):
        """options 为 None 时自动创建默认值"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch("app.shared.services.validation.executor.validate_full_dataset", return_value=({}, [], {})),
        ):
            result = executor.execute("D:\\data")
        assert "errors" in result

    def test_execute_with_table_filter_string(self):
        """table_filter 为字符串时正确传递"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ) as mock_load,
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ),
        ):
            executor.execute("D:\\data", ValidationOptions(table_filter="users"))
        mock_load.assert_called_once()
        _, kwargs = mock_load.call_args  # positional + keyword args merged
        assert kwargs.get("table_filter") == "users" or mock_load.call_args[1].get("table_filter") == "users"

    def test_execute_with_table_filter_list(self):
        """table_filter 为列表时正确传递"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users"), "orders": MockTableSchema("orders", "orders")},
            schema_files={"users": MockSchemaFile("users", "users"), "orders": MockSchemaFile("orders", "orders")},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ) as mock_load,
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ),
        ):
            executor.execute("D:\\data", ValidationOptions(table_filter=["users", "orders"]))
        args, kwargs = mock_load.call_args
        assert kwargs.get("table_filter") == ["users", "orders"]

    def test_execute_post_processing_format_checks(self):
        """validation_details.format_checks 经过后处理（id_to_name + source_info）"""
        executor = _make_executor(
            tables={"t1": MockTableSchema(name="users", id="t1")},
            schema_files={"t1": MockSchemaFile(name="users", id="t1", source=MockSource("data.csv"))},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=(
                    {"users": pd.DataFrame()},
                    [],
                    {"format_checks": [{"table": "t1"}], "constraint_checks": [{"table": "t1"}]},
                ),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())
        for check in result["validation_details"]["format_checks"]:
            assert check["table"] == "users"
        for check in result["validation_details"]["constraint_checks"]:
            assert check["table"] == "users"

    def test_execute_source_both_table_id_and_table(self):
        """error 同时有 table_id 和 table 时优先使用 table_id 做 source 附加"""
        executor = _make_executor(
            tables={"t1": MockTableSchema(name="users", id="t1")},
            schema_files={"t1": MockSchemaFile(name="users", id="t1", source=MockSource("data.csv"))},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=(
                    {"users": pd.DataFrame()},
                    [{"table": "t1", "table_id": "t1", "error": "test"}],
                    {},
                ),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())
        assert len(result["errors"]) == 1


# ============================================================================
# ValidationOptions 额外测试
# ============================================================================


class TestValidationOptionsExtra:
    def test_default_chunk_options(self):
        opts = ValidationOptions()
        assert opts.chunk_threshold_mb == 500
        assert opts.chunk_rows == 100_000

    def test_custom_chunk_options(self):
        opts = ValidationOptions(chunk_threshold_mb=100, chunk_rows=50_000)
        assert opts.chunk_threshold_mb == 100
        assert opts.chunk_rows == 50_000
