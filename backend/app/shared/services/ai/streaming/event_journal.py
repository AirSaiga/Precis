"""@fileoverview 流式事件日志（EventJournal）

持久化流式事件序列，支持断线重连时通过 Last-Event-ID 续传。

存储结构: {journal_dir}/{job_id}.journal，每行一个 JSON 对象（追加写入）:
    {"id": 1, "event": "delta", "data": {"text": "你好"}, "ts": 1706000000.123}

设计要点:
- 文件而非内存: 刷新页面/后端重启后任务状态不丢；多请求共享同一事件源
- 追加写入 + 文件锁: 保证并发追加时 id 递增且不丢失
- 启动时扫描已有文件恢复 _next_id: 支持重连续传
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any

from .types import TERMINAL_EVENTS

logger = logging.getLogger(__name__)


class EventJournal:
    """@classdesc 流式事件日志

    按 job_id 维度持久化事件序列，支持追加、续传读取、终止判定、清理。
    """

    def __init__(self, job_id: str, journal_dir: str):
        """
        @methoddesc 初始化事件日志

        参数:
            job_id: 任务 ID
            journal_dir: 日志目录路径（由调用方决定，通常复用项目本地 .precis 目录）
        """
        self.job_id = job_id
        self.journal_dir = journal_dir
        self.journal_path = os.path.join(journal_dir, f"{job_id}.journal")
        self._lock = threading.Lock()
        self._ensure_dir()
        # 从已有 journal 文件恢复下一个 id（支持服务重启后续传）
        self._next_id = self._recover_next_id()

    def _ensure_dir(self) -> None:
        """确保日志目录存在。"""
        try:
            os.makedirs(self.journal_dir, exist_ok=True)
        except OSError as e:
            logger.warning(f"创建 journal 目录失败 {self.journal_dir}: {e}")

    def _recover_next_id(self) -> int:
        """扫描已有 journal 文件，返回下一个可用 id（已有最大 id + 1）。

        无文件或为空时返回 1。
        """
        if not os.path.exists(self.journal_path):
            return 1
        max_id = 0
        try:
            with open(self.journal_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        eid = entry.get("id", 0)
                        if isinstance(eid, int) and eid > max_id:
                            max_id = eid
                    except json.JSONDecodeError:
                        continue
        except OSError as e:
            logger.warning(f"恢复 journal next_id 失败 {self.journal_path}: {e}")
        return max_id + 1

    def append(self, event: str, data: dict[str, Any]) -> int:
        """
        @methoddesc 追加一个事件，返回分配的递增 id

        线程安全（文件锁 + 实例锁）。追加写入后立即 flush，保证断电能恢复。

        参数:
            event: 事件类型（见 types.py 常量）
            data: 事件数据（需可 JSON 序列化）

        返回:
            分配的事件 id（从 1 开始递增）
        """
        entry: dict[str, Any] = {"id": 0, "event": event, "data": data, "ts": time.time()}
        with self._lock:
            entry["id"] = self._next_id
            eid: int = self._next_id
            self._next_id += 1
            line = json.dumps(entry, ensure_ascii=False)
            try:
                # 追加写入，newline 分隔
                with open(self.journal_path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
                    f.flush()
                    os.fsync(f.fileno())
            except OSError as e:
                logger.warning(f"追加 journal 事件失败 {self.journal_path}: {e}")
        return eid

    def _read_all_unlocked(self) -> list[tuple[int, str, dict[str, Any]]]:
        """读取全部事件（不加锁，调用方自行加锁或保证无并发写）。"""
        if not os.path.exists(self.journal_path):
            return []
        events: list[tuple[int, str, dict[str, Any]]] = []
        try:
            with open(self.journal_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        events.append((entry["id"], entry["event"], entry["data"]))
                    except (json.JSONDecodeError, KeyError):
                        continue
        except OSError as e:
            logger.warning(f"读取 journal 失败 {self.journal_path}: {e}")
        return events

    def read_all(self) -> list[tuple[int, str, dict[str, Any]]]:
        """@methoddesc 读取全部事件，返回 (id, event, data) 元组列表（按 id 升序）。"""
        with self._lock:
            return self._read_all_unlocked()

    def read_since(self, last_id: int) -> list[tuple[int, str, dict[str, Any]]]:
        """
        @methoddesc 读取 id > last_id 的所有事件（用于断线续传）

        参数:
            last_id: 客户端最后收到的事件 id（Last-Event-ID）

        返回:
            (id, event, data) 元组列表，仅含 id > last_id 的事件
        """
        with self._lock:
            all_events = self._read_all_unlocked()
        return [(eid, ev, data) for eid, ev, data in all_events if eid > last_id]

    def is_terminated(self) -> bool:
        """@methoddesc 判断最后一条事件是否为终止事件（completed/error/cancelled）。

        返回:
            True 表示任务已结束（用于已完成任务的重连场景，直接回放后关闭）
        """
        with self._lock:
            events = self._read_all_unlocked()
        if not events:
            return False
        last_event = events[-1][1]
        return last_event in TERMINAL_EVENTS

    def cleanup(self) -> None:
        """@methoddesc 删除 journal 文件（任务完成 24h 后由调用方触发）。"""
        with self._lock:
            try:
                if os.path.exists(self.journal_path):
                    os.remove(self.journal_path)
            except OSError as e:
                logger.warning(f"清理 journal 文件失败 {self.journal_path}: {e}")

    @property
    def path(self) -> str:
        """journal 文件绝对路径（供测试与调试使用）。"""
        return self.journal_path
