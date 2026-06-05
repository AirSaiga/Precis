"""
@fileoverview 内存监控工具单元测试

测试范围:
- MemoryMonitor.should_chunk: 文件大小阈值判断
- MemoryMonitor.get_file_size_mb: 文件大小计算
- MemoryMonitor.take_snapshot: 内存快照记录
- MemoryMonitor.get_chunk_count: 分块数量计算
- MemorySnapshot.to_dict: 快照序列化
"""

import os
import tempfile

from app.shared.services.validation.memory_monitor import (
    DEFAULT_CHUNK_ROWS,
    DEFAULT_CHUNK_THRESHOLD_MB,
    MemoryMonitor,
    MemorySnapshot,
)


class TestMemoryMonitor:
    """MemoryMonitor 核心功能测试。"""

    def test_default_values(self):
        """默认值应正确设置。"""
        monitor = MemoryMonitor()
        assert monitor.chunk_threshold_mb == DEFAULT_CHUNK_THRESHOLD_MB
        assert monitor.chunk_rows == DEFAULT_CHUNK_ROWS
        assert monitor.snapshots == []

    def test_custom_values(self):
        """自定义值应正确覆盖默认值。"""
        monitor = MemoryMonitor(chunk_threshold_mb=100, chunk_rows=50_000)
        assert monitor.chunk_threshold_mb == 100
        assert monitor.chunk_rows == 50_000

    def test_should_chunk_large_file(self):
        """大于阈值的文件应返回 True。"""
        monitor = MemoryMonitor(chunk_threshold_mb=0.001)  # 1KB 阈值
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as f:
            f.write(b"x" * 2000)  # 2KB 文件
            tmp_path = f.name
        try:
            assert monitor.should_chunk(tmp_path) is True
        finally:
            os.unlink(tmp_path)

    def test_should_not_chunk_small_file(self):
        """小于阈值的文件应返回 False。"""
        monitor = MemoryMonitor(chunk_threshold_mb=100)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as f:
            f.write(b"x" * 100)
            tmp_path = f.name
        try:
            assert monitor.should_chunk(tmp_path) is False
        finally:
            os.unlink(tmp_path)

    def test_should_not_chunk_nonexistent_file(self):
        """不存在的文件应返回 False（大小为 0）。"""
        monitor = MemoryMonitor()
        assert monitor.should_chunk("/nonexistent/file.csv") is False

    def test_get_file_size_mb(self):
        """文件大小应正确计算为 MB。"""
        monitor = MemoryMonitor()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as f:
            f.write(b"x" * (1024 * 1024))  # 1MB
            tmp_path = f.name
        try:
            size = monitor.get_file_size_mb(tmp_path)
            assert 0.99 <= size <= 1.01  # 允许浮点误差
        finally:
            os.unlink(tmp_path)

    def test_get_file_size_mb_nonexistent(self):
        """不存在的文件应返回 0.0。"""
        monitor = MemoryMonitor()
        assert monitor.get_file_size_mb("/nonexistent/file.csv") == 0.0

    def test_take_snapshot(self):
        """快照应正确记录文件信息。"""
        monitor = MemoryMonitor()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as f:
            f.write(b"x" * 1024)
            tmp_path = f.name
        try:
            snapshot = monitor.take_snapshot(tmp_path)
            assert isinstance(snapshot, MemorySnapshot)
            assert snapshot.file_path == tmp_path
            assert snapshot.file_size_mb > 0
            assert len(monitor.snapshots) == 1
        finally:
            os.unlink(tmp_path)

    def test_get_chunk_count(self):
        """分块数量应正确计算。"""
        monitor = MemoryMonitor(chunk_rows=100)
        assert monitor.get_chunk_count(0) == 1
        assert monitor.get_chunk_count(50) == 1
        assert monitor.get_chunk_count(100) == 1
        assert monitor.get_chunk_count(101) == 2
        assert monitor.get_chunk_count(250) == 3

    def test_get_progress_info_empty(self):
        """无快照时应返回正确的摘要信息。"""
        monitor = MemoryMonitor(chunk_threshold_mb=200, chunk_rows=50_000)
        info = monitor.get_progress_info()
        assert info["snapshot_count"] == 0
        assert info["latest_snapshot"] is None
        assert info["chunk_threshold_mb"] == 200
        assert info["chunk_rows"] == 50_000

    def test_get_progress_info_with_snapshot(self):
        """有快照时应包含最新快照信息。"""
        monitor = MemoryMonitor()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as f:
            f.write(b"x" * 1024)
            tmp_path = f.name
        try:
            monitor.take_snapshot(tmp_path)
            info = monitor.get_progress_info()
            assert info["snapshot_count"] == 1
            assert info["latest_snapshot"] is not None
            assert info["latest_snapshot"]["file_path"] == tmp_path
        finally:
            os.unlink(tmp_path)


class TestMemorySnapshot:
    """MemorySnapshot 数据类测试。"""

    def test_to_dict(self):
        """快照序列化应包含所有必要字段。"""
        snapshot = MemorySnapshot(
            file_path="/test/file.csv",
            file_size_mb=10.5,
        )
        d = snapshot.to_dict()
        assert d["file_path"] == "/test/file.csv"
        assert d["file_size_mb"] == 10.5

    def test_to_dict_with_system_memory(self):
        """有系统内存信息时应包含在序列化结果中。"""
        snapshot = MemorySnapshot(
            file_path="/test/file.csv",
            file_size_mb=10.5,
            system_memory={"total_mb": 16000, "available_mb": 8000, "used_mb": 8000, "percent": 50.0},
        )
        d = snapshot.to_dict()
        assert "system_memory" in d
        assert d["system_memory"]["total_mb"] == 16000
