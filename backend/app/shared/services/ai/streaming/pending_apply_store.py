"""@fileoverview 确认控制器与挂起 apply 存储

提供 apply_actions 两阶段确认所需的核心组件：
- ConfirmController: asyncio.Event 确认门，协程内 await gate.wait()（带超时）
- PendingApplyStore Protocol: 存储接口，功能 C 可实现持久化
- InMemoryPendingApplyStore: 进程内 dict 实现（默认）
- get_global_pending_store: 获取全局单例

设计要点:
- resolve() 幂等 + 原子（asyncio.Lock 保护 check-then-set，防止并发覆盖 decision）
- await_decision() 带 5 分钟超时，超时自动 reject（防止客户端断连后协程永久挂起）
- 全局 store 使用 threading.Lock 保护并发安全
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# apply 确认超时时间（秒）：超时后自动 reject，防止协程永久挂起
_APPLY_CONFIRM_TIMEOUT = 300.0


class ConfirmController:
    """@classdesc 确认门控制器

    在 apply_actions 协程内创建，调用 await_decision() 挂起协程。
    确认端点调用 resolve() 唤醒协程。
    超时未决策则自动返回 reject（防死锁）。
    """

    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None) -> None:
        self.request_id = request_id
        self.pending_payload = pending_payload
        self._gate = asyncio.Event()
        self._decision: str | None = None
        # asyncio.Lock 保证 resolve 的 check-then-set 原子性（防并发覆盖 decision）
        self._resolve_lock = asyncio.Lock()

    async def await_decision(self) -> str:
        """阻塞等待用户决策，返回 decision 字符串("confirm" 或 "reject")。

        带 5 分钟超时：超时自动返回 "reject"，防止客户端断连后协程永久挂起。
        """
        try:
            await asyncio.wait_for(self._gate.wait(), timeout=_APPLY_CONFIRM_TIMEOUT)
        except TimeoutError:
            logger.warning(
                "apply 确认超时(%ds)，自动 reject: request_id=%s",
                int(_APPLY_CONFIRM_TIMEOUT),
                self.request_id,
            )
            return "reject"
        return self._decision or "reject"

    async def resolve(self, decision: str) -> None:
        """唤醒协程并写入决策。已决议则忽略(幂等)。

        用 asyncio.Lock 保证 check-then-set 原子性，
        防止并发 resolve(confirm) + resolve(reject) 覆盖 decision。
        """
        async with self._resolve_lock:
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
    def get_all_by_job(self, job_id: str) -> list[ConfirmController]: ...
    def pop_by_job_prefix(self, job_id: str) -> list[ConfirmController]: ...


class InMemoryPendingApplyStore:
    """进程内 dict 实现。

    键语义：apply_id（格式 "{job_id}#{seq}"），支持同一 job 内多次 apply_actions 各自独立确认。
    兼容旧用法：get/pop 仍接受 job_id，内部回退到该 job 的唯一/首个挂起项。
    """

    def __init__(self) -> None:
        self._store: dict[str, ConfirmController] = {}
        self._lock = threading.Lock()

    def put(self, apply_id: str, controller: ConfirmController) -> None:
        with self._lock:
            self._store[apply_id] = controller

    def get(self, apply_id: str) -> ConfirmController | None:
        with self._lock:
            # 精确匹配 apply_id
            if apply_id in self._store:
                return self._store[apply_id]
            # 兼容回退：传入的是 job_id，找该 job 下唯一未决议项
            pending = [c for aid, c in self._store.items() if aid.startswith(f"{apply_id}#") and not c.is_resolved]
            return pending[0] if len(pending) == 1 else None

    def pop(self, apply_id: str) -> ConfirmController | None:
        with self._lock:
            if apply_id in self._store:
                return self._store.pop(apply_id)
            # 兼容回退
            matches = [
                (aid, c) for aid, c in self._store.items() if aid.startswith(f"{apply_id}#") and not c.is_resolved
            ]
            if len(matches) == 1:
                return self._store.pop(matches[0][0])
            return None

    def get_all_by_job(self, job_id: str) -> list[ConfirmController]:
        """获取某 job 下所有挂起的确认控制器（用于 cancel 时批量 reject）。"""
        with self._lock:
            prefix = f"{job_id}#"
            return [c for aid, c in self._store.items() if aid.startswith(prefix)]

    def pop_by_job_prefix(self, job_id: str) -> list[ConfirmController]:
        """弹出某 job 下所有挂起的确认控制器。"""
        with self._lock:
            prefix = f"{job_id}#"
            matched = [(aid, c) for aid, c in self._store.items() if aid.startswith(prefix)]
            for aid, _ in matched:
                self._store.pop(aid, None)
            return [c for _, c in matched]


_global_store: PendingApplyStore = InMemoryPendingApplyStore()


def get_global_pending_store() -> PendingApplyStore:
    """获取全局 PendingApplyStore 单例。

    功能 C 实现 PersistentPendingApplyStore 后，替换此处 _global_store 即可。
    """
    return _global_store
