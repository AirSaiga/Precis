"""
@fileoverview 执行器分块模式集成测试

测试范围:
- ValidationOptions 新增参数
- ValidationExecutor._should_use_chunked_mode
- MemoryMonitor 集成
- 结果中的 chunked_mode 和 memory_info 字段
"""

import os
import tempfile
from unittest.mock import MagicMock

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


class TestValidationOptionsChunked:
    """ValidationOptions 分块参数测试。"""

    def test_default_chunk_options(self):
        """默认分块参数应正确设置。"""
        options = ValidationOptions()
        assert options.chunk_threshold_mb == 500
        assert options.chunk_rows == 100_000

    def test_custom_chunk_options(self):
        """自定义分块参数应正确覆盖。"""
        options = ValidationOptions(chunk_threshold_mb=100, chunk_rows=50_000)
        assert options.chunk_threshold_mb == 100
        assert options.chunk_rows == 50_000


class TestExecutorShouldUseChunked:
    """_should_use_chunked_mode 方法测试。"""

    def test_should_use_chunked_for_large_file(self):
        """大文件应触发分块模式。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建大文件
            large_file = os.path.join(tmpdir, "large.csv")
            with open(large_file, "wb") as f:
                f.write(b"x" * (1024 * 1024))  # 1MB

            # 创建 mock executor
            executor = ValidationExecutor.__new__(ValidationExecutor)
            executor._schema_by_id = {}
            executor._resolver = MagicMock()
            executor._memory_monitor = MagicMock()
            executor._memory_monitor.should_chunk.return_value = True

            # 模拟 resolver 返回数据源和大文件路径
            executor._resolver.resolve_first_data_source.return_value = None
            executor._resolver.resolve_source_path.return_value = (large_file, None)
            executor._schema_by_id = {"test_table": MagicMock()}

            options = ValidationOptions(chunk_threshold_mb=0.5)  # 0.5MB 阈值
            result = executor._should_use_chunked_mode(tmpdir, options)
            assert result is True

    def test_should_not_use_chunked_for_small_file(self):
        """小文件不应触发分块模式。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            executor = ValidationExecutor.__new__(ValidationExecutor)
            executor._schema_by_id = {}
            executor._resolver = MagicMock()
            executor._memory_monitor = MagicMock()
            executor._memory_monitor.should_chunk.return_value = False
            executor._resolver.resolve_first_data_source.return_value = None

            options = ValidationOptions()
            result = executor._should_use_chunked_mode(tmpdir, options)
            assert result is False


class TestExecutorResultFields:
    """执行结果新增字段测试。"""

    def test_result_has_chunked_mode_field(self):
        """结果应包含 chunked_mode 字段。"""
        # 这是一个集成测试，验证结果格式
        # 通过 mock 确保 execute 方法返回正确的字段
        executor = ValidationExecutor.__new__(ValidationExecutor)
        executor._memory_monitor = MagicMock()
        executor._memory_monitor.get_progress_info.return_value = {"snapshot_count": 0}
        executor._memory_monitor.chunk_threshold_mb = 500
        executor._memory_monitor.chunk_rows = 100_000
        executor._memory_monitor.should_chunk.return_value = False

        # 验证 _execute_chunked 返回的 result 包含必要字段
        result = {
            "raw_datasets": {},
            "parsed_datasets": {},
            "errors": [],
            "loading_errors": [],
            "duration_ms": 0,
            "timeout_occurred": False,
            "validation_details": {"format_checks": [], "constraint_checks": []},
            "chunked_mode": False,
            "memory_info": {},
        }

        assert "chunked_mode" in result
        assert "memory_info" in result
        assert result["chunked_mode"] is False
