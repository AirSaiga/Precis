"""
@fileoverview SQL 加载器单元测试

测试 SQLLoader 的 load/validate 方法。
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.sql_loader import SQLLoader
from app.shared.core.data_source.specs.sql_source import SQLSourceSpec


class TestSQLLoaderValidate:
    def test_validate_ok(self):
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="users")
        loader = SQLLoader(spec)
        errors = loader.validate()
        assert errors == []

    def test_validate_empty_connection(self):
        spec = SQLSourceSpec(connection_string="", table_or_query="users")
        loader = SQLLoader(spec)
        errors = loader.validate()
        assert any("连接字符串" in e for e in errors)

    def test_validate_empty_query(self):
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="")
        loader = SQLLoader(spec)
        errors = loader.validate()
        assert any("表名" in e for e in errors)


class TestSQLLoaderLoad:
    def test_load_table_name(self):
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="users")
        loader = SQLLoader(spec)
        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__.return_value = mock_conn
        mock_df = pd.DataFrame({"a": [1]})

        with (
            patch("sqlalchemy.create_engine", return_value=mock_engine),
            patch("pandas.read_sql", return_value=mock_df),
        ):
            df = loader.load()
            assert df is mock_df

    def test_load_query(self):
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="SELECT * FROM users")
        loader = SQLLoader(spec)
        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__.return_value = mock_conn
        mock_df = pd.DataFrame({"a": [1]})

        with (
            patch("sqlalchemy.create_engine", return_value=mock_engine),
            patch("pandas.read_sql", return_value=mock_df),
        ):
            df = loader.load()
            assert df is mock_df

    def test_load_import_error(self):
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="users")
        loader = SQLLoader(spec)
        with (
            patch.dict("sys.modules", {"sqlalchemy": None}),
            patch("builtins.__import__", side_effect=ImportError("No module named sqlalchemy")),
        ):
            with pytest.raises(DataLoadError) as exc_info:
                loader.load()
            assert "sqlalchemy" in str(exc_info.value)

    def test_load_error(self):
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="users")
        loader = SQLLoader(spec)
        with patch("sqlalchemy.create_engine", side_effect=Exception("DB error")):
            with pytest.raises(DataLoadError) as exc_info:
                loader.load()
            assert "SQL 加载失败" in str(exc_info.value)
