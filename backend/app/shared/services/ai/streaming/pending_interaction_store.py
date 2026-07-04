"""@fileoverview 交互门控控制器与挂起交互存储

提供 apply_actions 两阶段确认与 ask_user 交互问答所需的核心组件：
- ConfirmController: apply 确认门（二元 confirm/reject，向后兼容，apply 代码仍用）
- InteractionController: 通用交互门（任意 dict response，ask_user 用）
- PendingInteractionStore Protocol: 存储接口（apply + ask 共用）
- InMemoryPendingInteractionStore: 进程内 dict 实现（默认）
- get_global_pending_interaction_store: 全局单例

设计要点:
- 两类 controller 共存于同一 store，靠 key 前缀区分：
  apply = "{job_id}#apply#{seq}"，ask = "{job_id}#ask#{seq}"
- resolve() 幂等 + 原子（asyncio.Lock 保护 check-then-set）
- await_decision() / await_response() 带超时，超时自动返回默认值（防死锁）
- 全局 store 使用 threading.Lock 保护并发安全
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# apply 确认超时时间（秒）：超时后自动 reject，防止协程永久挂起
_APPLY_CONFIRM_TIMEOUT = 300.0

# ask 交互超时时间（秒）：超时后自动返回 {skipped: true, reason: timeout}
_INTERACTION_TIMEOUT = 300.0


class ConfirmController:
    """@classdesc apply 确认门控制器（向后兼容，apply_actions 专用）

    在 apply_actions 协程内创建，调用 await_decision() 挂起协程。
    确认端点调用 resolve() 唤醒协程。超时未决策则自动返回 reject。
    """

    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None) -> None:
        self.request_id = request_id
        self.pending_payload = pending_payload
        self._gate = asyncio.Event()
        self._decision: str | None = None
        self._resolve_lock = asyncio.Lock()

    async def await_decision(self) -> str:
        """阻塞等待用户决策，返回 decision 字符串("confirm" 或 "reject")。

        带 5 分钟超时：超时自动返回 "reject"。
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
        """唤醒协程并写入决策。已决议则忽略(幂等)。"""
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


class InteractionController:
    """@classdesc 通用交互门控制器（ask_user 专用）

    与 ConfirmController 的区别：
    - ConfirmController: 二元 confirm/reject，await_decision() 返回固定字符串
    - InteractionController: 任意 dict response，await_response() 返回 dict

    在 ask_user 协程内创建，调用 await_response() 挂起协程。
    /respond 端点调用 resolve(response) 唤醒协程。
    超时自动返回 {skipped: true, reason: timeout}。
    """

    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None) -> None:
        self.request_id = request_id
        self.pending_payload = pending_payload  # question schema（发给前端的提问内容）
        self._gate = asyncio.Event()
        self._response: dict[str, Any] | None = None
        self._resolve_lock = asyncio.Lock()

    async def await_response(self) -> dict[str, Any]:
        """阻塞等待用户回答，返回 response dict。

        带 5 分钟超时：超时返回 {skipped: true, reason: timeout}，
        让 LLM 统一按 skip 处理（无需区分超时和主动跳过）。
        """
        try:
            await asyncio.wait_for(self._gate.wait(), timeout=_INTERACTION_TIMEOUT)
        except TimeoutError:
            logger.warning(
                "ask 等待超时(%ds)，自动 skip: request_id=%s",
                int(_INTERACTION_TIMEOUT),
                self.request_id,
            )
            return {"skipped": True, "reason": "timeout"}
        return self._response or {"skipped": True, "reason": "empty"}

    async def resolve(self, response: dict[str, Any]) -> None:
        """唤醒协程并写入回答。已决议则忽略(幂等)。"""
        async with self._resolve_lock:
            if self._gate.is_set():
                return
            self._response = response
            self._gate.set()

    @property
    def is_resolved(self) -> bool:
        return self._gate.is_set()

    @property
    def response(self) -> dict[str, Any] | None:
        return self._response


@runtime_checkable
class PendingInteractionStore(Protocol):
    """挂起交互存储接口(Protocol，功能 C 可替换为持久化实现)。

    apply 和 ask controller 共用此接口，靠 key 前缀区分类型。
    @runtime_checkable 让 isinstance 检查可用（用于依赖注入与测试断言）。
    """

    def put(self, interaction_id: str, controller: ConfirmController | InteractionController) -> None: ...
    def get(self, interaction_id: str) -> ConfirmController | InteractionController | None: ...
    def pop(self, interaction_id: str) -> ConfirmController | InteractionController | None: ...
    def get_all_by_job(self, job_id: str) -> list[ConfirmController | InteractionController]: ...
    def pop_by_job_prefix(self, job_id: str) -> list[ConfirmController | InteractionController]: ...


class InMemoryPendingInteractionStore:
    """进程内 dict 实现（apply + ask 共用）。

    键命名（统一加类型前缀）：
    - apply: "{job_id}#apply#{seq}"
    - ask:   "{job_id}#ask#{seq}"

    兼容回退：get/pop 传入 job_id 时，找该 job 下唯一未决议项
    （匹配 f"{job_id}#" 前缀，覆盖 apply 和 ask 两类）。
    """

    def __init__(self) -> None:
        self._store: dict[str, ConfirmController | InteractionController] = {}
        self._lock = threading.Lock()

    def put(self, interaction_id: str, controller: ConfirmController | InteractionController) -> None:
        with self._lock:
            self._store[interaction_id] = controller

    def get(self, interaction_id: str) -> ConfirmController | InteractionController | None:
        with self._lock:
            # 精确匹配 interaction_id（apply_id 或 ask_id）
            if interaction_id in self._store:
                return self._store[interaction_id]
            # 兼容回退：传入的是 job_id，找该 job 下唯一未决议项
            pending = [
                c for aid, c in self._store.items() if aid.startswith(f"{interaction_id}#") and not c.is_resolved
            ]
            return pending[0] if len(pending) == 1 else None

    def pop(self, interaction_id: str) -> ConfirmController | InteractionController | None:
        with self._lock:
            if interaction_id in self._store:
                return self._store.pop(interaction_id)
            # 兼容回退
            matches = [
                (aid, c) for aid, c in self._store.items() if aid.startswith(f"{interaction_id}#") and not c.is_resolved
            ]
            if len(matches) == 1:
                return self._store.pop(matches[0][0])
            return None

    def get_all_by_job(self, job_id: str) -> list[ConfirmController | InteractionController]:
        """获取某 job 下所有挂起的 controller（apply + ask，用于 cancel 时批量清理）。"""
        with self._lock:
            prefix = f"{job_id}#"
            return [c for aid, c in self._store.items() if aid.startswith(prefix)]

    def pop_by_job_prefix(self, job_id: str) -> list[ConfirmController | InteractionController]:
        """弹出某 job 下所有挂起的 controller。"""
        with self._lock:
            prefix = f"{job_id}#"
            matched = [(aid, c) for aid, c in self._store.items() if aid.startswith(prefix)]
            for aid, _ in matched:
                self._store.pop(aid, None)
            return [c for _, c in matched]


_global_store: PendingInteractionStore = InMemoryPendingInteractionStore()


def get_global_pending_interaction_store() -> PendingInteractionStore:
    """获取全局 PendingInteractionStore 单例。"""
    return _global_store
