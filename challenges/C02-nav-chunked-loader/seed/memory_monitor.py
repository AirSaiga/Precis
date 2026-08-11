"""内存监控与分块决策（C02 seed）。

决定大文件是否分块加载。AGENTS.md："大文件支持分块加载（>500MB 阈值）"。
真实代码见 backend/app/shared/services/validation/memory_monitor.py。
"""

from __future__ import annotations


DEFAULT_CHUNK_THRESHOLD_MB = 500


class MemoryMonitor:
    """根据文件大小决定是否分块。"""

    def __init__(self, chunk_threshold_mb: int = DEFAULT_CHUNK_THRESHOLD_MB):
        self.chunk_threshold_mb = chunk_threshold_mb

    def should_chunk(self, file_size_mb: float) -> bool:
        """文件大小超过阈值则分块。"""
        return file_size_mb > self.chunk_threshold_mb

    def chunk_size(self, file_size_mb: float) -> int:
        """计算每块的行数（简化版：固定返回 10000）。"""
        if not self.should_chunk(file_size_mb):
            return 0  # 不分块
        return 10000
