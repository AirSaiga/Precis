"""
@fileoverview 分块数据加载器单元测试

测试范围:
- ChunkedDataLoader 初始化
- ChunkedDataLoader._load_csv_chunked: CSV 分块加载
- ChunkedDataLoader._load_dataframe_chunked: 按类型分派
- ChunkedValidationResult 数据类
"""

import os
import tempfile

import pytest

from app.shared.services.validation.chunked_loader import (
    ChunkedDataLoader,
    ChunkedValidationResult,
)


class TestChunkedValidationResult:
    """ChunkedValidationResult 数据类测试。"""

    def test_default_values(self):
        """默认值应为空容器。"""
        result = ChunkedValidationResult()
        assert result.parsed_datasets == {}
        assert result.errors == []
        assert result.validation_details == {"format_checks": [], "constraint_checks": []}
        assert result.loading_errors == []
        assert result.chunk_count == 0
        assert result.total_rows == 0
        assert result.warnings == []

    def test_custom_values(self):
        """自定义值应正确设置。"""
        result = ChunkedValidationResult(
            chunk_count=5,
            total_rows=1000,
            errors=[{"error_type": "test"}],
        )
        assert result.chunk_count == 5
        assert result.total_rows == 1000
        assert len(result.errors) == 1


class TestChunkedDataLoaderCSV:
    """ChunkedDataLoader CSV 分块加载测试。"""

    def test_load_csv_chunked(self):
        """CSV 文件应被正确分块加载。"""
        # 创建临时 CSV 文件（250 行）
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".csv", newline="") as f:
            f.write("id,name,value\n")
            for i in range(250):
                f.write(f"{i},name_{i},{i * 10}\n")
            tmp_path = f.name

        try:
            # 创建一个简单的 mock schema
            class MockSchema:
                header_row = 0
                source_config = {"delimiter": ","}

            # 直接调用分块加载
            loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
            chunks = loader._load_csv_chunked(tmp_path, MockSchema(), chunk_size=100)

            assert len(chunks) == 3  # 250 行 / 100 = 3 个分块
            assert len(chunks[0]) == 100
            assert len(chunks[1]) == 100
            assert len(chunks[2]) == 50

            # 验证列名
            assert list(chunks[0].columns) == ["id", "name", "value"]
        finally:
            os.unlink(tmp_path)

    def test_load_csv_chunked_small_file(self):
        """小文件应产生单个分块。"""
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".csv", newline="") as f:
            f.write("id,name\n")
            for i in range(10):
                f.write(f"{i},name_{i}\n")
            tmp_path = f.name

        try:
            class MockSchema:
                header_row = 0
                source_config = {"delimiter": ","}

            loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
            chunks = loader._load_csv_chunked(tmp_path, MockSchema(), chunk_size=100)

            assert len(chunks) == 1
            assert len(chunks[0]) == 10
        finally:
            os.unlink(tmp_path)


class TestChunkedDataLoaderDataFrameChunked:
    """_load_dataframe_chunked 按文件类型分派测试。"""

    def test_csv_dispatch(self):
        """CSV 文件应被正确分派到 CSV 分块加载。"""
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".csv", newline="") as f:
            f.write("id,name\n")
            for i in range(150):
                f.write(f"{i},name_{i}\n")
            tmp_path = f.name

        try:
            class MockSchema:
                header_row = 0
                source_config = {"delimiter": ","}

            loader = ChunkedDataLoader.__new__(ChunkedDataLoader)
            chunks = loader._load_dataframe_chunked(tmp_path, MockSchema(), chunk_size=100)

            assert len(chunks) == 2
            assert len(chunks[0]) == 100
            assert len(chunks[1]) == 50
        finally:
            os.unlink(tmp_path)

    def test_unsupported_format_raises(self):
        """不支持的文件格式应抛出 ValueError。"""
        loader = ChunkedDataLoader.__new__(ChunkedDataLoader)

        class MockSchema:
            header_row = 0
            source_config = {}

        with pytest.raises(ValueError, match="不支持的文件格式"):
            loader._load_dataframe_chunked("/fake/file.xyz", MockSchema(), chunk_size=100)
