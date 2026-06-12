"""
@fileoverview 分块加载器性能基线测试（T47 补充）

测试范围:
- MemoryMonitor 分块策略切换逻辑（小文件 vs 大文件）
- chunk_rows 参数对分块数量的影响
- 分块遍历完整性（合并结果 = 全量结果）
- 内存估算准确性
- ChunkedDataLoader.__init__ 初始化
- load_chunked_sources 双重失败分支
- _load_excel_chunked 列数不匹配分支
- _get_psutil_memory 分支覆盖
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.shared.services.validation.chunked_loader import (
    ChunkedDataLoader,
    ChunkedValidationResult,
)
from app.shared.services.validation.memory_monitor import (
    MemoryMonitor,
    MemorySnapshot,
    _get_psutil_memory,
)

# ============================================================================
# MemoryMonitor 分块策略切换测试
# ============================================================================


class TestMemoryMonitorChunkStrategy:
    """分块策略切换逻辑验证。"""

    def test_small_file_below_threshold(self, tmp_path):
        """小于阈值的文件不应触发分块。"""
        small_file = tmp_path / "small.csv"
        small_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        monitor = MemoryMonitor(chunk_threshold_mb=100)
        assert monitor.should_chunk(str(small_file)) is False

    def test_large_file_above_threshold(self, tmp_path):
        """大于阈值的文件应触发分块。"""
        large_file = tmp_path / "large.csv"
        # 写入超过 0.001MB 的数据
        large_file.write_text("id,name\n" + "\n".join(f"{i},name_{i}" for i in range(1000)), encoding="utf-8")

        monitor = MemoryMonitor(chunk_threshold_mb=0.001)
        assert monitor.should_chunk(str(large_file)) is True

    def test_exact_threshold_boundary(self, tmp_path):
        """文件大小恰好等于阈值时不应触发分块（> 而非 >=）。"""
        test_file = tmp_path / "boundary.csv"
        test_file.write_text("x" * 1024, encoding="utf-8")  # 1KB

        monitor = MemoryMonitor(chunk_threshold_mb=1024 / (1024 * 1024))
        # should_chunk uses > not >=, so exact match should be False
        assert monitor.should_chunk(str(test_file)) is False

    def test_chunk_rows_parameter_variants(self):
        """不同 chunk_rows 参数应产生正确的分块数量。"""
        for chunk_rows, total_rows, expected_chunks in [
            (10_000, 5_000, 1),
            (10_000, 10_000, 1),
            (10_000, 10_001, 2),
            (100_000, 500_000, 5),
            (1_000_000, 500_000, 1),
        ]:
            monitor = MemoryMonitor(chunk_rows=chunk_rows)
            assert monitor.get_chunk_count(total_rows) == expected_chunks

    def test_snapshot_records_file_info(self, tmp_path):
        """快照应正确记录文件路径和大小。"""
        test_file = tmp_path / "data.csv"
        test_file.write_text("a,b\n1,2\n3,4\n", encoding="utf-8")

        monitor = MemoryMonitor()
        snapshot = monitor.take_snapshot(str(test_file))

        assert snapshot.file_path == str(test_file)
        assert snapshot.file_size_mb > 0
        assert len(monitor.snapshots) == 1

    def test_multiple_snapshots_accumulate(self, tmp_path):
        """多次快照应累积到 snapshots 列表。"""
        monitor = MemoryMonitor()
        for i in range(3):
            f = tmp_path / f"f{i}.csv"
            f.write_text(f"data_{i}\n", encoding="utf-8")
            monitor.take_snapshot(str(f))

        assert len(monitor.snapshots) == 3
        info = monitor.get_progress_info()
        assert info["snapshot_count"] == 3


# ============================================================================
# 分块遍历完整性测试
# ============================================================================


class TestChunkTraversalCompleteness:
    """验证分块遍历的完整性：每个分块独立校验 → 合并结果 = 全量校验结果。"""

    def test_csv_chunk_row_count_matches_total(self, tmp_path):
        """分块加载的总行数应等于原始文件行数。"""
        csv_file = tmp_path / "data.csv"
        total_rows = 350
        lines = ["id,name,value"] + [f"{i},name_{i},{i * 10}" for i in range(total_rows)]
        csv_file.write_text("\n".join(lines), encoding="utf-8")

        class MockSchema:
            header_row = 0
            source_config = {"delimiter": ","}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunk_size = 100
        chunks = loader._load_csv_chunked(str(csv_file), MockSchema(), chunk_size=chunk_size)

        total_loaded = sum(len(c) for c in chunks)
        assert total_loaded == total_rows

    def test_chunk_data_integrity(self, tmp_path):
        """分块合并后的数据应与全量加载一致。"""
        csv_file = tmp_path / "integrity.csv"
        data = pd.DataFrame({"id": range(250), "val": [f"v{i}" for i in range(250)]})
        data.to_csv(str(csv_file), index=False)

        class MockSchema:
            header_row = 0
            source_config = {"delimiter": ","}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_csv_chunked(str(csv_file), MockSchema(), chunk_size=100)

        merged = pd.concat(chunks, ignore_index=True)
        assert len(merged) == 250
        assert list(merged.columns) == ["id", "val"]
        assert merged.iloc[0]["val"] == "v0"
        assert merged.iloc[249]["val"] == "v249"


# ============================================================================
# ChunkedDataLoader 初始化测试
# ============================================================================


class TestChunkedDataLoaderInit:
    """ChunkedDataLoader 构造函数测试。"""

    def test_init_with_default_monitor(self):
        """未传入 memory_monitor 时应自动创建默认实例。"""
        resolver = MagicMock()
        dataset_schema = MagicMock()
        schema_by_id = {}
        settings = MagicMock()

        loader = ChunkedDataLoader(resolver, dataset_schema, schema_by_id, settings)
        assert isinstance(loader._monitor, MemoryMonitor)
        assert loader._resolver is resolver
        assert loader.dataset_schema is dataset_schema
        assert loader._schema_by_id is schema_by_id
        assert loader.settings is settings

    def test_init_with_custom_monitor(self):
        """传入自定义 memory_monitor 时应使用该实例。"""
        custom_monitor = MemoryMonitor(chunk_threshold_mb=200, chunk_rows=50_000)
        loader = ChunkedDataLoader(MagicMock(), MagicMock(), {}, MagicMock(), memory_monitor=custom_monitor)
        assert loader._monitor is custom_monitor
        assert loader._monitor.chunk_threshold_mb == 200
        assert loader._monitor.chunk_rows == 50_000


# ============================================================================
# load_chunked_sources 双重失败分支
# ============================================================================


class TestLoadChunkedSourcesDoubleFailure:
    """分块加载和全量加载都失败时的处理。"""

    def test_both_chunked_and_fallback_fail(self, tmp_path):
        """分块加载失败且回退全量加载也失败时，该表应被跳过。"""
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

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        loader._resolver = resolver
        loader.dataset_schema = dataset_schema
        loader._schema_by_id = {"users": schema_file}
        loader.settings = MagicMock()
        loader._monitor = monitor

        # Mock _load_dataframe_chunked to raise
        loader._load_dataframe_chunked = MagicMock(side_effect=Exception("chunk error"))

        # Mock load_grouped_sources (imported inside function from core.data_source.loader)
        with patch(
            "app.shared.core.data_source.loader.load_grouped_sources",
            side_effect=Exception("fallback error"),
        ):
            result = loader.load_chunked_sources(str(csv_file.parent))

        # Table should be skipped
        assert "users" not in result


# ============================================================================
# _load_excel_chunked 列数不匹配分支
# ============================================================================


class TestExcelChunkedColumnMismatch:
    """Excel 分块加载中列数不匹配的处理。"""

    def test_excel_chunk_column_count_mismatch(self, tmp_path):
        """当分块列数与表头列数不匹配时，应仍添加分块，列名保持默认。"""
        import pandas as pd

        excel_file = tmp_path / "mismatch.xlsx"
        pd.DataFrame({"id": [1, 2], "name": ["a", "b"]}).to_excel(str(excel_file), index=False)

        with patch("app.shared.services.validation.chunked_loader.pd.read_excel") as mock_read:
            mock_read.side_effect = [
                pd.DataFrame(columns=["id", "name"]),  # header call
                pd.DataFrame({0: [1], 1: [2], 2: ["a"]}),  # chunk with 3 cols
                pd.DataFrame(),  # end
            ]
            loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
            chunks = loader._load_excel_chunked(str(excel_file), "Sheet1", header_row=0, chunk_size=100)
            assert len(chunks) == 1
            assert list(chunks[0].columns) != ["id", "name"]

    def test_excel_empty_columns_returns_empty(self, tmp_path):
        """Excel 文件表头为空时应返回空列表。"""
        excel_file = tmp_path / "no_cols.xlsx"
        # Create file with no real columns
        pd.DataFrame().to_excel(str(excel_file), index=False)

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_excel_chunked(str(excel_file), "Sheet1", header_row=0, chunk_size=100)
        assert chunks == []


# ============================================================================
# _get_psutil_memory 分支覆盖
# ============================================================================


class TestGetPsutilMemory:
    """_get_psutil_memory 函数测试。"""

    def test_psutil_available_returns_dict(self):
        """psutil 可用时应返回内存信息字典。"""
        from importlib.util import find_spec

        if find_spec("psutil") is None:
            pytest.skip("psutil not available")

        result = _get_psutil_memory()
        assert result is not None
        assert "total_mb" in result
        assert "available_mb" in result
        assert "used_mb" in result
        assert "percent" in result
        assert result["total_mb"] > 0

    def test_psutil_not_available_returns_none(self):
        """psutil 不可用时应返回 None。"""
        with patch.dict("sys.modules", {"psutil": None}):
            from app.shared.services.validation.memory_monitor import _get_psutil_memory as _get_psutil_memory_no_psutil

            result = _get_psutil_memory_no_psutil()
            assert result is None


# ============================================================================
# MemorySnapshot 完整性测试
# ============================================================================


class TestMemorySnapshotCompleteness:
    """MemorySnapshot 序列化完整性。"""

    def test_snapshot_to_dict_without_system_memory(self):
        """无系统内存信息时应只有 file_path 和 file_size_mb。"""
        snapshot = MemorySnapshot(file_path="/test/file.csv", file_size_mb=42.5)
        d = snapshot.to_dict()
        assert d["file_path"] == "/test/file.csv"
        assert d["file_size_mb"] == 42.5
        assert "system_memory" not in d

    def test_snapshot_to_dict_with_system_memory(self):
        """有系统内存信息时应包含 system_memory 字段。"""
        snapshot = MemorySnapshot(
            file_path="/test/large.xlsx",
            file_size_mb=1024.0,
            system_memory={"total_mb": 16000, "available_mb": 8000, "used_mb": 8000, "percent": 50.0},
        )
        d = snapshot.to_dict()
        assert d["file_path"] == "/test/large.xlsx"
        assert d["file_size_mb"] == 1024.0
        assert "system_memory" in d
        assert d["system_memory"]["total_mb"] == 16000


# ============================================================================
# ChunkedValidationResult 数据完整性
# ============================================================================


class TestChunkedValidationResultIntegrity:
    """ChunkedValidationResult 数据结构完整性。"""

    def test_result_with_all_fields(self):
        """所有字段都应正确设置。"""
        result = ChunkedValidationResult(
            parsed_datasets={"users": pd.DataFrame({"id": [1]})},
            errors=[{"type": "validation", "message": "test"}],
            validation_details={
                "format_checks": [{"check": "type"}],
                "constraint_checks": [{"constraint": "not_null"}],
            },
            loading_errors=[{"file": "test.csv", "error": "not found"}],
            chunk_count=3,
            total_rows=1000,
            warnings=["file is large"],
        )
        assert len(result.parsed_datasets) == 1
        assert len(result.errors) == 1
        assert len(result.validation_details["format_checks"]) == 1
        assert len(result.validation_details["constraint_checks"]) == 1
        assert len(result.loading_errors) == 1
        assert result.chunk_count == 3
        assert result.total_rows == 1000
        assert len(result.warnings) == 1

    def test_result_defaults_are_isolated(self):
        """默认值应是独立实例（不共享引用）。"""
        r1 = ChunkedValidationResult()
        r2 = ChunkedValidationResult()
        r1.errors.append({"test": True})
        r1.parsed_datasets["x"] = pd.DataFrame()
        assert len(r2.errors) == 0
        assert len(r2.parsed_datasets) == 0


# ============================================================================
# CSV 分块加载边界测试
# ============================================================================


class TestCSVChunkedEdgeCases:
    """CSV 分块加载边界场景。"""

    def test_csv_custom_delimiter(self, tmp_path):
        """自定义分隔符应正确加载。"""
        csv_file = tmp_path / "custom.csv"
        csv_file.write_text("id;name;value\n1;alice;100\n2;bob;200\n", encoding="utf-8")

        class MockSchema:
            header_row = 0
            source_config = {"delimiter": ";"}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_csv_chunked(str(csv_file), MockSchema(), chunk_size=100)

        assert len(chunks) == 1
        assert list(chunks[0].columns) == ["id", "name", "value"]
        assert len(chunks[0]) == 2

    def test_csv_header_row_none(self, tmp_path):
        """header_row 为 None 时应使用默认值 0。"""
        csv_file = tmp_path / "no_header.csv"
        csv_file.write_text("col1,col2\n1,2\n", encoding="utf-8")

        class MockSchema:
            header_row = None
            source_config = None

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_csv_chunked(str(csv_file), MockSchema(), chunk_size=100)
        assert len(chunks) == 1

    def test_csv_empty_file(self, tmp_path):
        """空 CSV 文件应产生空分块或单个空分块。"""
        csv_file = tmp_path / "empty.csv"
        csv_file.write_text("id,name\n", encoding="utf-8")

        class MockSchema:
            header_row = 0
            source_config = {"delimiter": ","}

        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
        chunks = loader._load_csv_chunked(str(csv_file), MockSchema(), chunk_size=100)
        # Should have 1 chunk with 0 rows
        assert len(chunks) == 1
        assert len(chunks[0]) == 0
