"""
@fileoverview ValidationExecutor 路径解析单元测试

测试 _resolve_first_data_source 和 resolve_source_path。
"""

import os
from unittest.mock import MagicMock, patch

from app.shared.services.validation.executor import ValidationExecutor


class MockDataSource:
    def __init__(self, mode="relative", path="data"):
        self.mode = mode
        self.path = path


class MockManifest:
    def __init__(self, data_sources=None):
        self.data_sources = data_sources or []
        self.settings = MagicMock()
        self.settings.validation = MagicMock()
        self.settings.file_processing = MagicMock()
        self.settings.script_security = MagicMock()


class MockLoadedProject:
    def __init__(self, manifest=None, schema_files=None):
        self.manifest = manifest or MockManifest()
        self.schema_files = schema_files or {}
        self.dataset_schema = MagicMock()


def _make_executor(project_root="D:\\project", manifest=None, schema_files=None):
    with (
        patch("app.shared.services.validation.executor.load_project") as mock_load,
        patch("os.path.exists", return_value=True),
    ):
        lp = MockLoadedProject(manifest=manifest or MockManifest(), schema_files=schema_files)
        mock_load.return_value = lp
        executor = ValidationExecutor(os.path.join(project_root, "project.precis.yaml"))
        executor.project_root = project_root
        return executor


class TestResolveFirstDataSource:
    def test_no_data_sources(self):
        executor = _make_executor()
        assert executor._resolver.resolve_first_data_source() is None

    def test_absolute_existing(self, tmp_path):
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        manifest = MockManifest(data_sources=[MockDataSource("absolute", str(data_dir))])
        executor = _make_executor(project_root=str(tmp_path), manifest=manifest)
        result = executor._resolver.resolve_first_data_source()
        assert result == str(data_dir)

    def test_absolute_nonexistent(self):
        manifest = MockManifest(data_sources=[MockDataSource("absolute", "D:\\nonexistent")])
        executor = _make_executor(manifest=manifest)
        assert executor._resolver.resolve_first_data_source() is None

    def test_relative_existing(self, tmp_path):
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        manifest = MockManifest(data_sources=[MockDataSource("relative", "data")])
        executor = _make_executor(project_root=str(tmp_path), manifest=manifest)
        result = executor._resolver.resolve_first_data_source()
        assert result == str(data_dir)

    def test_relative_nonexistent(self):
        manifest = MockManifest(data_sources=[MockDataSource("relative", "nonexistent")])
        executor = _make_executor(manifest=manifest)
        assert executor._resolver.resolve_first_data_source() is None


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


class TestResolveSourcePath:
    def test_absolute_file(self):
        executor = _make_executor()
        schema = MockSchemaFile(source=MockSource("absolute_file", "D:\\data.csv"))
        path, sheet = executor._resolver.resolve_source_path("D:\\data", schema)
        assert path == "D:\\data.csv"
        assert sheet is None

    def test_relative_file_existing(self, tmp_path):
        csv_file = tmp_path / "data.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(source=MockSource("relative_file", "data.csv"))
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(csv_file)

    def test_relative_file_nonexistent(self, tmp_path):
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(source=MockSource("relative_file", "missing.csv"))
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        # Returns the joined path even if file doesn't exist
        assert path == os.path.normpath(os.path.join(str(tmp_path), "missing.csv"))

    def test_auto_discovery_in_directory(self, tmp_path):
        csv_file = tmp_path / "users.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(name="users", source=None)
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(csv_file)
        assert sheet is None

    def test_auto_discovery_with_sheet(self, tmp_path):
        xlsx_file = tmp_path / "users.xlsx"
        import pandas as pd

        pd.DataFrame({"a": [1]}).to_excel(xlsx_file, index=False)
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(name="users", source=None, sheet="Sheet1")
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path == str(xlsx_file)
        assert sheet == "Sheet1"

    def test_auto_discovery_not_found(self, tmp_path):
        executor = _make_executor(project_root=str(tmp_path))
        schema = MockSchemaFile(name="missing", source=None)
        path, sheet = executor._resolver.resolve_source_path(str(tmp_path), schema)
        assert path is None
        assert sheet is None
