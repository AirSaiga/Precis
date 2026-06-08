"""
@fileoverview 数据加载器单元测试

测试范围:
- DataLoader.load_data_sources: 批量加载数据文件
- DataLoader._collect_foreign_key_tables: 外键关联表收集
- DataLoader._resolve_search_directory: 搜索目录解析
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock, patch

import pandas as pd

from app.shared.services.validation.data_loader import DataLoader


class TestResolveSearchDirectory:
    def test_uses_manifest_data_source(self):
        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = "/configured/path"

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver

        result = loader._resolve_search_directory("/default/path")
        assert result == "/configured/path"

    def test_falls_back_to_default(self):
        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = None

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver

        result = loader._resolve_search_directory("/default/path")
        assert result == "/default/path"


class TestCollectForeignKeyTables:
    def test_collects_fk_target(self):
        constraint = MagicMock()
        constraint.from_table = "orders"
        constraint.to_table = "users"
        constraint.reference_table = None

        dataset_schema = MagicMock()
        dataset_schema.constraints = [constraint]

        loader = DataLoader.__new__(DataLoader)
        loader.dataset_schema = dataset_schema

        result = loader._collect_foreign_key_tables({"orders"})
        assert "users" in result
        assert "orders" in result

    def test_collects_reference_table(self):
        constraint = MagicMock()
        constraint.from_table = "orders"
        constraint.to_table = None
        constraint.reference_table = "customers"

        dataset_schema = MagicMock()
        dataset_schema.constraints = [constraint]

        loader = DataLoader.__new__(DataLoader)
        loader.dataset_schema = dataset_schema

        result = loader._collect_foreign_key_tables({"orders"})
        assert "customers" in result

    def test_no_fk_constraints(self):
        constraint = MagicMock()
        constraint.from_table = "other"
        constraint.to_table = "x"
        constraint.reference_table = None

        dataset_schema = MagicMock()
        dataset_schema.constraints = [constraint]

        loader = DataLoader.__new__(DataLoader)
        loader.dataset_schema = dataset_schema

        result = loader._collect_foreign_key_tables({"orders"})
        assert result == {"orders"}


class TestLoadDataSources:
    def test_directory_not_exists(self, tmp_path):
        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(tmp_path / "nonexistent")

        dataset_schema = MagicMock()
        dataset_schema.tables = {}
        dataset_schema.constraints = []

        settings = MagicMock()
        settings.file_processing.default_encoding = "utf-8"
        settings.file_processing.csv_delimiter = ","

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {}
        loader.settings = settings

        datasets, errors = loader.load_data_sources(str(tmp_path / "nonexistent"))
        assert datasets == {}
        assert len(errors) == 1
        assert errors[0]["error_type"] == "DirectoryNotFound"

    def test_no_schema_file_skipped(self, tmp_path):
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)

        table_schema = MagicMock()
        table_schema.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}
        dataset_schema.constraints = []

        settings = MagicMock()
        settings.file_processing.default_encoding = "utf-8"
        settings.file_processing.csv_delimiter = ","

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {}
        loader.settings = settings

        datasets, errors = loader.load_data_sources(str(data_dir))
        assert datasets == {}

    def test_no_source_path_adds_error(self, tmp_path):
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)
        resolver.resolve_source_path.return_value = (None, None)

        table_schema = MagicMock()
        table_schema.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}
        dataset_schema.constraints = []

        settings = MagicMock()
        settings.file_processing.default_encoding = "utf-8"
        settings.file_processing.csv_delimiter = ","

        schema_file = MagicMock()

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {"users": schema_file}
        loader.settings = settings

        datasets, errors = loader.load_data_sources(str(data_dir))
        assert "users" not in datasets
        assert any(e["error_type"] == "SourceNotFound" for e in errors)

    def test_string_filter(self, tmp_path):
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)

        t1 = MagicMock()
        t1.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": t1}
        dataset_schema.constraints = []

        settings = MagicMock()
        settings.file_processing.default_encoding = "utf-8"
        settings.file_processing.csv_delimiter = ","

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {}
        loader.settings = settings

        # Use string filter
        datasets, errors = loader.load_data_sources(str(data_dir), table_filter="users")
        assert datasets == {}

    def test_list_filter(self, tmp_path):
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)

        t1 = MagicMock()
        t1.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": t1}
        dataset_schema.constraints = []

        settings = MagicMock()
        settings.file_processing.default_encoding = "utf-8"
        settings.file_processing.csv_delimiter = ","

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {}
        loader.settings = settings

        datasets, errors = loader.load_data_sources(str(data_dir), table_filter=["users"])
        assert datasets == {}

    def test_successful_load(self, tmp_path):
        csv_file = tmp_path / "data" / "users.csv"
        csv_file.parent.mkdir()
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(csv_file.parent)
        resolver.resolve_source_path.return_value = (str(csv_file), None)

        table_schema = MagicMock()
        table_schema.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}
        dataset_schema.constraints = []

        settings = MagicMock()
        settings.file_processing.default_encoding = "utf-8"
        settings.file_processing.csv_delimiter = ","

        schema_file = MagicMock()

        loader = DataLoader.__new__(DataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {"users": schema_file}
        loader.settings = settings

        with patch(
            "app.shared.services.validation.data_loader.load_grouped_sources",
            return_value=({"users": pd.DataFrame({"id": [1], "name": ["alice"]})}, []),
        ):
            datasets, errors = loader.load_data_sources(str(csv_file.parent))

        assert "users" in datasets
        assert len(errors) == 0
