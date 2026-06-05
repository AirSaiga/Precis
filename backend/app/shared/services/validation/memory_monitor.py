"""
@fileoverview 内存监控工具模块

功能概述:
- 提供文件大小检测和内存使用监控
- 支持自动判断是否需要分块处理
- 记录校验过程中的内存使用情况

架构设计:
- 纯工具模块，无外部依赖（仅使用标准库 + psutil 可选）
- 由 ValidationExecutor 调用，决定是否启用分块模式

使用示例:
    monitor = MemoryMonitor(chunk_threshold_mb=500)
    if monitor.should_chunk(file_path):
        # 使用分块加载
        pass
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# 默认分块阈值（MB）
DEFAULT_CHUNK_THRESHOLD_MB = 500

# 每个分块的目标行数（CSV 分块读取用）
DEFAULT_CHUNK_ROWS = 100_000


def _get_psutil_memory() -> dict[str, float] | None:
    """尝试使用 psutil 获取系统内存信息，不可用时返回 None。"""
    try:
        import psutil

        mem = psutil.virtual_memory()
        return {
            "total_mb": mem.total / (1024 * 1024),
            "available_mb": mem.available / (1024 * 1024),
            "used_mb": mem.used / (1024 * 1024),
            "percent": mem.percent,
        }
    except ImportError:
        return None


@dataclass
class MemorySnapshot:
    """内存快照，记录某个时间点的内存使用情况。"""

    file_path: str
    file_size_mb: float
    system_memory: dict[str, float] | None = None
    timestamp: float = 0.0

    def to_dict(self) -> dict:
        result = {
            "file_path": self.file_path,
            "file_size_mb": round(self.file_size_mb, 2),
        }
        if self.system_memory:
            result["system_memory"] = {k: round(v, 2) for k, v in self.system_memory.items()}
        return result


@dataclass
class MemoryMonitor:
    """
    @classdesc 内存监控器

    负责：
    - 检测文件大小，判断是否需要分块处理
    - 记录内存使用快照
    - 提供分块建议（chunk_size 行数）

    属性:
        chunk_threshold_mb: 触发分块模式的文件大小阈值（MB），默认 500MB
        chunk_rows: 每个分块的默认行数，默认 100,000
        snapshots: 记录的内存快照列表
    """

    chunk_threshold_mb: float = DEFAULT_CHUNK_THRESHOLD_MB
    chunk_rows: int = DEFAULT_CHUNK_ROWS
    snapshots: list[MemorySnapshot] = field(default_factory=list)

    def get_file_size_mb(self, file_path: str) -> float:
        """获取文件大小（MB）。"""
        try:
            size_bytes = os.path.getsize(file_path)
            return size_bytes / (1024 * 1024)
        except OSError:
            return 0.0

    def should_chunk(self, file_path: str) -> bool:
        """
        @methoddesc 判断指定文件是否需要分块处理

        基于文件大小阈值判断。当文件大于 chunk_threshold_mb 时返回 True。

        参数:
            file_path: 文件路径

        返回:
            True 表示需要分块处理
        """
        size_mb = self.get_file_size_mb(file_path)
        return size_mb > self.chunk_threshold_mb

    def take_snapshot(self, file_path: str) -> MemorySnapshot:
        """
        @methoddesc 记录内存快照

        拍摄当前内存使用快照并追加到 snapshots 列表。

        参数:
            file_path: 正在处理的文件路径

        返回:
            MemorySnapshot 实例
        """
        snapshot = MemorySnapshot(
            file_path=file_path,
            file_size_mb=self.get_file_size_mb(file_path),
            system_memory=_get_psutil_memory(),
        )
        self.snapshots.append(snapshot)
        logger.info(
            f"内存快照: 文件={os.path.basename(file_path)}, "
            f"大小={snapshot.file_size_mb:.1f}MB"
            + (f", 可用内存={snapshot.system_memory['available_mb']:.0f}MB" if snapshot.system_memory else "")
        )
        return snapshot

    def get_chunk_count(self, total_rows: int) -> int:
        """
        @methoddesc 计算给定总行数需要多少个分块

        参数:
            total_rows: 总行数

        返回:
            分块数量（至少为 1）
        """
        if total_rows <= 0:
            return 1
        return max(1, (total_rows + self.chunk_rows - 1) // self.chunk_rows)

    def get_progress_info(self) -> dict:
        """
        @methoddesc 获取内存监控摘要信息

        返回:
            包含快照数量和最新快照信息的字典
        """
        return {
            "snapshot_count": len(self.snapshots),
            "latest_snapshot": self.snapshots[-1].to_dict() if self.snapshots else None,
            "chunk_threshold_mb": self.chunk_threshold_mb,
            "chunk_rows": self.chunk_rows,
        }
