"""
@fileoverview ValidationExecutor 边缘分支单元测试

覆盖 resolve_source_path 路径修正、auto-discovery 递归搜索、
execute 后处理（config errors / id_to_name / timeout）等边缘分支。
"""

import os
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


class MockSource:
    def __init__(self, mode="relative_file", path="data.csv", sheet=None):
        self.mode = mode
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
        self.settings.file_processing = MagicMock()
        self.settings.file_processing.default_encoding = "utf-8"
        self.settings.file_processing.csv_delimiter = ","
        self.settings.script_security = MagicMock()
        self.settings.script_security.allow_eval = False
        self.settings.script_security.allow_exec = False


class MockDataSource:
    def __init__(self, mode="relative", path="data"):
        self.mode = mode
        self.path = path


class MockTableSchema:
    def __init__(self, name="users", id=None):
        self.name = name
        self.id = id or name


class MockDatasetSchema:
    def __init__(self, tables=None, constraints=None):
        self.tables = tables or {}
        self.constraints = constraints or []


class MockLoadingError:
    def __init__(self, msg="error"):
        self._msg = msg

    def to_dict(self):
        return {"error_type": "LoadError", "message": self._msg}


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
# resolve_source_path 边缘分支
# ============================================================================


class TestResolveSourcePathEdgeCases:
    def test_source_sheet_fallback(self, tmp_path):
        """schema.sheet 为 None 时回退到 source.sheet"""
        csv_file = tmp_path / "data.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(source=MockSource("relative_file", "data.csv", sheet="Sheet1"))
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(csv_file)
        assert sheet == "Sheet1"

    def test_path_duplication_adjustment(self, tmp_path):
        """source.path 错误包含项目目录名时的修正路径"""
        project_name = tmp_path.name
        csv_file = tmp_path / "data.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        executor = _make_executor(project_root=str(tmp_path))
        # path 错误地包含了项目目录名
        schema = MockSchemaFile(source=MockSource("relative_file", f"{project_name}/data.csv"))
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(csv_file)

    def test_auto_discovery_with_data_source(self, tmp_path):
        """manifest 配置了 data_sources 时优先使用第一个数据源目录"""
        data_dir = tmp_path / "external"
        data_dir.mkdir()
        csv_file = data_dir / "users.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        ds = MockDataSource("absolute", str(data_dir))
        executor = _make_executor(
            project_root=str(tmp_path),
            data_sources=[ds],
        )
        schema = MockSchemaFile(name="users", source=None)
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(csv_file)

    def test_auto_discovery_recursive_walk(self, tmp_path):
        """在子目录中递归发现文件"""
        sub_dir = tmp_path / "nested"
        sub_dir.mkdir()
        csv_file = sub_dir / "users.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(name="users", source=None)
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(csv_file)

    def test_auto_discovery_json_extension(self, tmp_path):
        """自动发现 json 文件（无 sheet 时的扩展名优先级）"""
        json_file = tmp_path / "users.json"
        json_file.write_text("[]", encoding="utf-8")
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(name="users", source=None)
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(json_file)

    def test_auto_discovery_skips_hidden_dirs(self, tmp_path):
        """递归搜索时跳过隐藏目录"""
        hidden_dir = tmp_path / ".hidden"
        hidden_dir.mkdir()
        csv_file = hidden_dir / "users.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        # 同时在没有文件的根目录也放一份，否则找不到
        # 这个测试主要验证 os.walk 的 dirs 过滤逻辑被走到
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(name="users", source=None)
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        # 因为隐藏目录被跳过，且根目录没有 users.csv，所以应该找不到
        assert path is None


# ============================================================================
# load_data_sources 边缘分支
# ============================================================================


class TestLoadDataSourcesEdgeCases:
    def test_reference_table_auto_load(self):
        """外键约束使用 reference_table（替代 to_table）时自动加载引用表"""
        fk_constraint = MagicMock()
        fk_constraint.table = "users"
        fk_constraint.to_table = None
        fk_constraint.reference_table = "orders"
        executor = _make_executor(
            tables={
                "users": MockTableSchema("users"),
                "orders": MockTableSchema("orders"),
            },
            constraints=[fk_constraint],
            schema_files={
                "users": MockSchemaFile("users", "users"),
                "orders": MockSchemaFile("orders", "orders"),
            },
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


# ============================================================================
# execute 边缘分支
# ============================================================================


class TestExecuteEdgeCases:
    def test_config_loading_errors(self):
        """execute 将 loaded_project.loading_errors 附加到结果"""
        err = MockLoadingError("schema load failed")
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
            loading_errors=[err],
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())
        assert any(e.get("message") == "schema load failed" for e in result["loading_errors"])

    def test_warnings_in_result(self):
        """execute 将 loaded_project.warnings 放入结果"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
            warnings=["deprecated field used"],
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())
        assert result["warnings"] == ["deprecated field used"]

    def test_post_processing_id_to_name(self):
        """execute 后处理将 table_id 映射为 table_name"""
        executor = _make_executor(
            tables={"t1": MockTableSchema(name="users", id="t1")},
            schema_files={"t1": MockSchemaFile(name="users", id="t1")},
        )
        validation_errors = [
            {"table": "t1", "message": "error1"},
            {"from_table": "t1", "to_table": "t1", "message": "fk error"},
        ]
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=(
                    {"users": pd.DataFrame()},
                    validation_errors,
                    {"format_checks": [{"table": "t1"}], "constraint_checks": [{"table": "t1"}]},
                ),
            ),
        ):
            result = executor.execute("D:\\data", ValidationOptions())
        # errors 中的 table id 应被映射为 name
        assert all(e.get("table") == "users" for e in result["errors"] if "table" in e)
        assert all(e.get("from_table") == "users" for e in result["errors"] if "from_table" in e)
        assert all(e.get("to_table") == "users" for e in result["errors"] if "to_table" in e)

    def test_validate_full_dataset_exception(self):
        """validate_full_dataset 抛出异常时应被捕获并重新抛出"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch("app.shared.services.validation.executor.validate_full_dataset", side_effect=RuntimeError("boom")),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                executor.execute("D:\\data", ValidationOptions())

    def test_loading_timeout(self):
        """模拟数据加载阶段超时"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        call_count = [0]

        def fake_monotonic():
            call_count[0] += 1
            # 第一次返回 0，第二次（超时检查）返回超过 timeout 的值
            return 0 if call_count[0] == 1 else 100

        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch("app.shared.services.validation.executor.time.monotonic", side_effect=fake_monotonic),
        ):
            result = executor.execute("D:\\data", ValidationOptions(timeout_seconds=10))
        assert result["timeout_occurred"] is True
        assert any(e["error_type"] == "Timeout" for e in result["errors"])

    def test_validation_timeout(self):
        """模拟数据校验阶段超时"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        call_count = [0]

        def fake_monotonic():
            call_count[0] += 1
            # 第1次=0（开始），第2次=1（加载后检查），第3次=100（校验后检查）
            return {1: 0, 2: 1, 3: 100}.get(call_count[0], 0)

        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ),
            patch("app.shared.services.validation.executor.time.monotonic", side_effect=fake_monotonic),
        ):
            result = executor.execute("D:\\data", ValidationOptions(timeout_seconds=10))
        assert result["timeout_occurred"] is True
        assert any("校验阶段超时" in e["message"] for e in result["errors"])

    def test_script_security_allow_eval(self):
        """【安全加固】V2 全量校验路径中 allow_unsafe_eval 始终为 False，即使 script_security.allow_eval=True"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        executor.settings.script_security.allow_eval = True
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ) as mock_validate,
        ):
            executor.execute("D:\\data", ValidationOptions())
        _, kwargs = mock_validate.call_args
        assert kwargs["allow_unsafe_eval"] is False

    def test_script_security_allow_exec(self):
        """【安全加固】V2 全量校验路径中 allow_unsafe_eval 始终为 False，即使 script_security.allow_exec=True"""
        executor = _make_executor(
            tables={"users": MockTableSchema("users", "users")},
            schema_files={"users": MockSchemaFile("users", "users")},
        )
        executor.settings.script_security.allow_exec = True
        with (
            patch.object(
                executor._data_loader, "load_data_sources", return_value=({"users": pd.DataFrame({"a": [1]})}, [])
            ),
            patch(
                "app.shared.services.validation.executor.validate_full_dataset",
                return_value=({"users": pd.DataFrame()}, [], {}),
            ) as mock_validate,
        ):
            executor.execute("D:\\data", ValidationOptions())
        _, kwargs = mock_validate.call_args
        assert kwargs["allow_unsafe_eval"] is False

    def test_options_allow_unsafe_eval_can_override(self):
        """options.allow_unsafe_eval 可显式覆盖默认值"""
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
                return_value=({"users": pd.DataFrame()}, [], {}),
            ) as mock_validate,
        ):
            executor.execute("D:\\data", ValidationOptions(allow_unsafe_eval=True))
        _, kwargs = mock_validate.call_args
        assert kwargs["allow_unsafe_eval"] is True
