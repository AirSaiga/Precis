"""
@fileoverview SQL 加载器单元测试

测试 SQLLoader 的 load/validate 方法。
"""

from threading import Thread
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.shared.core.data_source.loaders import sql_loader as sql_loader_module
from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.sql_loader import SQLLoader
from app.shared.core.data_source.specs.sql_source import SQLSourceSpec


@pytest.fixture(autouse=True)
def _clear_engine_cache():
    """每个测试前后清空模块级 engine 缓存，避免跨测试污染（B-locksafety）。"""
    with sql_loader_module._engine_cache_lock:
        sql_loader_module._engine_cache.clear()
    yield
    with sql_loader_module._engine_cache_lock:
        sql_loader_module._engine_cache.clear()


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


class TestEngineCacheConcurrency:
    """B-locksafety: engine 缓存的线程安全与 LRU 淘汰。"""

    def test_concurrent_same_connection_string_creates_one_engine(self):
        """多线程并发请求同一新连接串，create_engine 应只被调用一次（锁防竞态）。"""
        spec = SQLSourceSpec(connection_string="sqlite:///test.db", table_or_query="users")
        loader = SQLLoader(spec)
        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__.return_value = mock_conn
        mock_df = pd.DataFrame({"a": [1]})

        call_count = {"n": 0}

        def fake_create_engine(_conn_str):
            call_count["n"] += 1
            return mock_engine

        threads = []

        def _hit():
            with (
                patch("sqlalchemy.create_engine", side_effect=fake_create_engine),
                patch("pandas.read_sql", return_value=mock_df),
            ):
                loader.load()

        for _ in range(8):
            t = Thread(target=_hit)
            threads.append(t)
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 8 个线程并发，但 create_engine 只应被调用一次（命中缓存）
        assert call_count["n"] == 1

    def test_lru_eviction_disposes_old_engine(self):
        """缓存超容量时淘汰最久未用的 engine，并调用其 dispose()。"""
        # 准备 _ENGINE_CACHE_MAX + 2 个不同的 mock engine
        engines = [MagicMock() for _ in range(sql_loader_module._ENGINE_CACHE_MAX + 2)]
        conn_strings = [f"sqlite:///db{i}.db" for i in range(len(engines))]
        engine_map = dict(zip(conn_strings, engines))

        def fake_create_engine(conn_str):
            return engine_map[conn_str]

        for cs in conn_strings:
            spec = SQLSourceSpec(connection_string=cs, table_or_query="users")
            loader = SQLLoader(spec)
            with patch("sqlalchemy.create_engine", side_effect=fake_create_engine):
                loader._get_engine(cs)

        # 缓存已超容量，最早的 engine 应被淘汰并 dispose
        engines[0].dispose.assert_called_once()
        engines[1].dispose.assert_called_once()
        # 最后放入的几个仍在缓存中，未被 dispose
        engines[-1].dispose.assert_not_called()
