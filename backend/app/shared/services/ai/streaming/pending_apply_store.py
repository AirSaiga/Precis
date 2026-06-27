"""@fileoverview 确认控制器与挂起 apply 存储

提供 apply_actions 两阶段确认所需的核心组件：
- ConfirmController: asyncio.Event 确认门，协程内 await gate.wait()
- PendingApplyStore Protocol: 存储接口，功能 C 可实现持久化
- InMemoryPendingApplyStore: 进程内 dict 实现（默认）
- get_global_pending_store: 获取全局单例

设计要点:
- resolve() 幂等，已决议的 controller 不再变更
- 全局 store 使用 threading.Lock 保护并发安全(executor 串行,但端点与协程可能并发)
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Protocol


class ConfirmController:
    """@classdesc 确认门控制器

    在 apply_actions 协程内创建，调用 await_decision() 挂起协程。
    确认端点调用 resolve() 唤醒协程。
    """

    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None) -> None:
        self.request_id = request_id
        self.pending_payload = pending_payload
        self._gate = asyncio.Event()
        self._decision: str | None = None

    async def await_decision(self) -> str:
        """阻塞等待用户决策，返回 decision 字符串("confirm" 或 "reject")。"""
        await self._gate.wait()
        return self._decision or "reject"

    def resolve(self, decision: str) -> None:
        """唤醒协程并写入决策。已决议则忽略(幂等)。"""
        if self._gate.is_set():
            return
        self._decision = decision
        self._gate.set()

    @property
    def is_resolved(self) -> bool:
        return self._gate.is_set()

    @property
    def decision(self) -> str | None:
        return self._decision


class PendingApplyStore(Protocol):
    """PendingApply 存储接口(Protocol，功能 C 可替换为持久化实现)。"""

    def put(self, job_id: str, controller: ConfirmController) -> None: ...
    def get(self, job_id: str) -> ConfirmController | None: ...
    def pop(self, job_id: str) -> ConfirmController | None: ...


class InMemoryPendingApplyStore:
    """进程内 dict 实现。executor 串行确保每 job 至多 1 挂起。"""

    def __init__(self) -> None:
        self._store: dict[str, ConfirmController] = {}
        self._lock = threading.Lock()

    def put(self, job_id: str, controller: ConfirmController) -> None:
        with self._lock:
            self._store[job_id] = controller

    def get(self, job_id: str) -> ConfirmController | None:
        with self._lock:
            return self._store.get(job_id)

    def pop(self, job_id: str) -> ConfirmController | None:
        with self._lock:
            return self._store.pop(job_id, None)


_global_store: PendingApplyStore = InMemoryPendingApplyStore()


def get_global_pending_store() -> PendingApplyStore:
    """获取全局 PendingApplyStore 单例。

    功能 C 实现 PersistentPendingApplyStore 后，替换此处 _global_store 即可。
    """
    return _global_store
