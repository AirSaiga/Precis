"""
@fileoverview 分块数据加载器深度测试

补充测试范围:
- ChunkedDataLoader._load_excel_chunked: Excel 分块加载
- ChunkedDataLoader._load_dataframe_chunked: JSON/JSONL 全量加载后切分
- ChunkedDataLoader.load_chunked_sources: 完整分块加载流程
- CSV 无 source_config 分支
- CSV 分块加载异常分支
"""

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.shared.services.validation.chunked_loader import (
    ChunkedDataLoader,
)
from app.shared.services.validation.memory_monitor import MemoryMonitor


class TestLoadExcelChunked:
    def test_excel_chunked_basic(self, tmp_path):
        """Excel 文件应按行分块加载。"""
        excel_file = tmp_path / "test.xlsx"
        df = pd.DataFrame({"id": range(250), "name": [f"name_{i}" for i in range(250)]})
        df.to_excel(str(excel_file), index=False)

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_excel_chunked(str(excel_file), "Sheet1", header_row=0, chunk_size=100)

        assert len(chunks) == 3
        assert len(chunks[0]) == 100
        assert len(chunks[1]) == 100
        assert len(chunks[2]) == 50
        assert list(chunks[0].columns) == ["id", "name"]

    def test_excel_chunked_empty_sheet(self, tmp_path):
        """空 Excel 文件应返回空列表。"""
        excel_file = tmp_path / "empty.xlsx"
        pd.DataFrame().to_excel(str(excel_file), index=False)

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_excel_chunked(str(excel_file), "Sheet1", header_row=0, chunk_size=100)

        assert chunks == []

    def test_excel_chunked_error_raises(self, tmp_path):
        """Excel 分块加载失败应抛出异常。"""
        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        with pytest.raises(Exception):
            loader._load_excel_chunked("/nonexistent.xlsx", "Sheet1", 0, 100)


class TestLoadDataframeChunkedDispatch:
    def test_xlsx_dispatch(self, tmp_path):
        """xlsx 文件应分派到 Excel 分块加载。"""
        excel_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": [1, 2]}).to_excel(str(excel_file), index=False)

        class MockSchema:
            header_row = 0
            sheet_name = "Sheet1"

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_dataframe_chunked(str(excel_file), MockSchema(), chunk_size=100)
        assert len(chunks) == 1
        assert len(chunks[0]) == 2

    def test_json_full_load_then_split(self, tmp_path):
        """JSON 文件应全量加载后按 chunk_size 切分。"""
        json_file = tmp_path / "test.json"
        data = [{"id": i, "val": f"v{i}"} for i in range(250)]
        import json

        json_file.write_text(json.dumps(data), encoding="utf-8")

        class MockSchema:
            header_row = 0
            source_config = {}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        # Mock the _LOADER_FNS to actually load JSON
        with patch(
            "app.shared.core.data_source.loader._LOADER_FNS",
            {".json": lambda fp, schemas: {"t": pd.read_json(fp)}},
        ):
            chunks = loader._load_dataframe_chunked(str(json_file), MockSchema(), chunk_size=100)

        assert len(chunks) == 3
        assert len(chunks[0]) == 100

    def test_json_no_loader_raises(self):
        """不支持的格式（无 loader）应抛出 ValueError。"""

        class MockSchema:
            header_row = 0
            source_config = {}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        with patch("app.shared.core.data_source.loader._LOADER_FNS", {}):
            with pytest.raises(ValueError, match="不支持的文件格式"):
                loader._load_dataframe_chunked("/fake/file.xyz", MockSchema(), chunk_size=100)

    def test_json_empty_result(self, tmp_path):
        """JSON loader 返回空 dict 时应返回空列表。"""
        json_file = tmp_path / "test.json"
        json_file.write_text("[]", encoding="utf-8")

        class MockSchema:
            header_row = 0
            source_config = {}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        with patch(
            "app.shared.core.data_source.loader._LOADER_FNS",
            {".json": lambda fp, schemas: {}},
        ):
            chunks = loader._load_dataframe_chunked(str(json_file), MockSchema(), chunk_size=100)

        assert chunks == []


class TestLoadCSVChunkedNoSourceConfig:
    def test_csv_no_source_config(self, tmp_path):
        """CSV 加载应支持无 source_config 的 schema。"""
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id,name\n1,a\n2,b\n", encoding="utf-8")

        class MockSchema:
            header_row = 0
            source_config = None  # No source_config

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_csv_chunked(str(csv_file), MockSchema(), chunk_size=100)
        assert len(chunks) == 1
        assert len(chunks[0]) == 2

    def test_csv_error_raises(self, tmp_path):
        """CSV 分块加载失败应抛出异常。"""
        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)

        class MockSchema:
            header_row = 0
            source_config = {}

        with pytest.raises(Exception):
            loader._load_csv_chunked("/nonexistent.csv", MockSchema(), chunk_size=100)


class TestLoadChunkedSources:
    def _make_loader(self, resolver, dataset_schema, schema_by_id, monitor=None):
        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = schema_by_id
        loader.settings = MagicMock()
        loader._monitor = monitor or MemoryMonitor()
        return loader

    def test_directory_not_exists(self, tmp_path):
        """数据目录不存在时应返回空字典。"""
        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(tmp_path / "nonexistent")

        dataset_schema = MagicMock()
        dataset_schema.tables = {}

        loader = self._make_loader(resolver, dataset_schema, {})
        result, _loading_errors = loader.load_chunked_sources(str(tmp_path / "nonexistent"))
        assert result == {}

    def test_no_schema_file_skipped(self, tmp_path):
        """schema_by_id 中找不到对应 schema 时跳过该表。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)

        table_schema = MagicMock()
        table_schema.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}

        loader = self._make_loader(resolver, dataset_schema, {})
        result, _loading_errors = loader.load_chunked_sources(str(data_dir))
        assert result == {}

    def test_no_source_path_skipped(self, tmp_path):
        """未找到数据源路径时跳过。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)
        resolver.resolve_source_path.return_value = (None, None)

        table_schema = MagicMock()
        table_schema.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}

        schema_file = MagicMock()
        loader = self._make_loader(resolver, dataset_schema, {"users": schema_file})
        result, _loading_errors = loader.load_chunked_sources(str(data_dir))
        assert result == {}

    def test_small_file_full_load(self, tmp_path):
        """小文件应全量加载为单个分块。"""
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

        schema_file = MagicMock()
        monitor = MemoryMonitor(chunk_threshold_mb=1000)  # Never chunk

        loader = self._make_loader(resolver, dataset_schema, {"users": schema_file}, monitor)
        result, _loading_errors = loader.load_chunked_sources(str(csv_file.parent))
        assert "users" in result
        assert len(result["users"]) == 1

    def test_large_file_chunked(self, tmp_path):
        """大文件应启用分块加载。"""
        csv_file = tmp_path / "data" / "users.csv"
        csv_file.parent.mkdir()
        lines = ["id,name"] + [f"{i},name_{i}" for i in range(300)]
        csv_file.write_text("\n".join(lines), encoding="utf-8")

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(csv_file.parent)
        resolver.resolve_source_path.return_value = (str(csv_file), None)

        table_schema = MagicMock()
        table_schema.name = "users"
        table_schema.header_row = 0
        table_schema.source_config = {"delimiter": ","}
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}

        schema_file = MagicMock()
        monitor = MemoryMonitor(chunk_threshold_mb=0.0001, chunk_rows=100)  # Always chunk

        loader = self._make_loader(resolver, dataset_schema, {"users": schema_file}, monitor)
        result, _loading_errors = loader.load_chunked_sources(str(csv_file.parent))
        assert "users" in result
        assert len(result["users"]) == 3

    def test_table_filter(self, tmp_path):
        """表过滤应只加载匹配的表。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)

        t1 = MagicMock()
        t1.name = "users"
        t2 = MagicMock()
        t2.name = "orders"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": t1, "orders": t2}

        loader = self._make_loader(resolver, dataset_schema, {})
        result, _loading_errors = loader.load_chunked_sources(str(data_dir), table_filter="users")
        # No source path found for either, so result is empty
        assert result == {}

    def test_chunked_load_failure_fallback(self, tmp_path):
        """分块加载失败应回退到全量加载。"""
        csv_file = tmp_path / "data" / "users.csv"
        csv_file.parent.mkdir()
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(csv_file.parent)
        resolver.resolve_source_path.return_value = (str(csv_file), None)

        table_schema = MagicMock()
        table_schema.name = "users"
        table_schema.header_row = 0
        table_schema.source_config = {"delimiter": ","}
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": table_schema}

        schema_file = MagicMock()
        monitor = MagicMock()
        monitor.should_chunk.return_value = True
        monitor.chunk_rows = 100
        monitor.take_snapshot.return_value = None

        loader = self._make_loader(resolver, dataset_schema, {"users": schema_file}, monitor)

        # Mock _load_dataframe_chunked to raise
        loader._load_dataframe_chunked = MagicMock(side_effect=Exception("chunk error"))

        result, _loading_errors = loader.load_chunked_sources(str(csv_file.parent))
        # Should fall back to full load
        assert "users" in result

    def test_filter_string_vs_list(self, tmp_path):
        """表过滤应支持字符串和列表两种形式。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)

        t1 = MagicMock()
        t1.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": t1}

        loader = self._make_loader(resolver, dataset_schema, {})

        # String filter
        loader.load_chunked_sources(str(data_dir), table_filter="users")
        # List filter
        loader.load_chunked_sources(str(data_dir), table_filter=["users"])

    def test_returns_loading_errors_tuple(self, tmp_path):
        """回归 #5: load_chunked_sources 应返回 (datasets, loading_errors) 元组,
        使调用方(executor)能感知单表加载失败,而非让该表静默消失。

        原实现只返回 datasets 字典,所有错误(源找不到/加载异常/全量回退也失败)仅
        logger 后吞掉,executor 无从感知 → 某表损坏时该表完全不校验、报告无任何提示,
        用户拿到"全部通过"的假报告。
        """
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(data_dir)
        # 该表的数据源找不到
        resolver.resolve_source_path.return_value = (None, None)

        t1 = MagicMock()
        t1.name = "broken_table"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"broken_table": t1}

        schema_file = MagicMock()
        loader = self._make_loader(resolver, dataset_schema, {"broken_table": schema_file})

        result = loader.load_chunked_sources(str(data_dir))
        # 必须是 (datasets, loading_errors) 二元组
        assert isinstance(result, tuple) and len(result) == 2
        datasets, loading_errors = result
        assert datasets == {}, "找不到数据源的表不应进 datasets"
        assert len(loading_errors) >= 1, f"应上报加载错误,实际: {loading_errors}"
        err = loading_errors[0]
        assert err.get("error_type") == "SourceNotFound"
        assert "broken_table" in str(err.get("message", "")) or err.get("table") == "broken_table"

    def test_load_exception_surfaces_as_loading_error(self, tmp_path):
        """回归 #5: 小文件加载抛异常时,应作为 loading_errors 返回,而非静默吞掉。"""
        csv_file = tmp_path / "data" / "users.csv"
        csv_file.parent.mkdir()
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(csv_file.parent)
        resolver.resolve_source_path.return_value = (str(csv_file), None)

        t1 = MagicMock()
        t1.name = "users"
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": t1}

        loader = self._make_loader(resolver, dataset_schema, {"users": MagicMock()})

        # 让全量加载(load_grouped_sources)抛异常。load_grouped_sources 在方法内局部导入,
        # 所以 patch 其真实定义模块。
        with patch(
            "app.shared.core.data_source.loader.load_grouped_sources",
            side_effect=Exception("boom"),
        ):
            datasets, loading_errors = loader.load_chunked_sources(str(csv_file.parent))

        assert datasets == {}, "加载失败的表不应进 datasets"
        assert len(loading_errors) >= 1, f"应上报加载异常,实际: {loading_errors}"
        assert loading_errors[0].get("table") == "users"

    def test_chunked_and_full_both_fail_surfaces_error(self, tmp_path):
        """回归 #5: 分块加载失败且全量回退也失败时,应上报错误而非静默 continue。"""
        csv_file = tmp_path / "data" / "users.csv"
        csv_file.parent.mkdir()
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        resolver = MagicMock()
        resolver.resolve_first_data_source.return_value = str(csv_file.parent)
        resolver.resolve_source_path.return_value = (str(csv_file), None)

        t1 = MagicMock()
        t1.name = "users"
        t1.header_row = 0
        t1.source_config = {"delimiter": ","}
        dataset_schema = MagicMock()
        dataset_schema.tables = {"users": t1}

        monitor = MagicMock()
        monitor.should_chunk.return_value = True
        monitor.chunk_rows = 100
        monitor.take_snapshot.return_value = None

        loader = self._make_loader(resolver, dataset_schema, {"users": MagicMock()}, monitor)
        # 分块加载本身抛异常
        loader._load_dataframe_chunked = MagicMock(side_effect=Exception("chunk boom"))

        # 全量回退也失败
        with patch(
            "app.shared.core.data_source.loader.load_grouped_sources",
            side_effect=Exception("full boom"),
        ):
            datasets, loading_errors = loader.load_chunked_sources(str(csv_file.parent))

        assert datasets == {}
        assert len(loading_errors) >= 1, f"分块+全量都失败应上报,实际: {loading_errors}"
        assert loading_errors[0].get("table") == "users"
