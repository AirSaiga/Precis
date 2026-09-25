# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 交互门控控制器与挂起交互存储

提供 apply_actions 两阶段确认与 ask_user 交互问答所需的核心组件：
- ConfirmController: apply 确认门（结构化 outcome，await_outcome 为主入口）
- InteractionController: 通用交互门（任意 dict response，ask_user 用）
- PendingInteractionStore Protocol: 存储接口（apply + ask 共用）
- InMemoryPendingInteractionStore: 进程内 dict 实现（默认）
- get_global_pending_interaction_store: 全局单例

设计要点:
- 两类 controller 共存于同一 store，靠 key 前缀区分：
  apply = "{job_id}#apply#{seq}"，ask = "{job_id}#ask#{seq}"
- resolve() 幂等 + 原子（asyncio.Lock 保护 check-then-set）
- await_outcome() / await_response() 带超时，超时自动返回兜底结果（防死锁），
  且区分"用户显式决策"与"系统兜底"（超时 / 客户端断连），消费方据此生成准确文案
- 全局 store 使用 threading.Lock 保护并发安全
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# apply 确认超时时间（秒）：超时后自动兜底，防止协程永久挂起
_APPLY_CONFIRM_TIMEOUT = 300.0

# ask 交互超时时间（秒）：超时后自动返回 {skipped: true, reason: ...}
_INTERACTION_TIMEOUT = 300.0

# 决策结果（await_outcome 返回的 decision 字段取值）：
# - confirm / reject: 用户显式决策（confirm 端点、CLI 终端输入）
# - timeout:          等待超时且 SSE 客户端仍在连接（用户未响应确认框）
# - disconnected:     等待超时且 SSE 客户端已断开（网络抖动/休眠/组件卸载），
#                     或任务终止时系统兜底唤醒——均非用户决策
DECISION_CONFIRM = "confirm"
DECISION_REJECT = "reject"
DECISION_TIMEOUT = "timeout"
DECISION_DISCONNECTED = "disconnected"


class ConfirmController:
    """@classdesc apply 确认门控制器（向后兼容，apply_actions 专用）

    在 apply_actions 协程内创建，调用 await_outcome() 挂起协程。
    确认端点调用 resolve() 唤醒协程。超时未决策则返回 timeout/disconnected 兜底结果。
    """

    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None) -> None:
        self.request_id = request_id
        self.pending_payload = pending_payload
        self._gate = asyncio.Event()
        self._decision: str | None = None
        self._resolve_lock = asyncio.Lock()
        # SSE 客户端失联标记：断开后置位，超时兜底时据此区分 timeout 与 disconnected
        self._client_gone = False

    async def await_outcome(self) -> dict[str, Any]:
        """阻塞等待决策，返回结构化结果 {"decision": "confirm"|"reject"|"timeout"|"disconnected"}。

        decision 语义见模块级 DECISION_* 常量：confirm/reject 是用户显式决策，
        timeout/disconnected 是系统兜底（后者表示 SSE 客户端已断开或任务终止）。
        带 5 分钟超时：超时按 _client_gone 标记区分两种兜底结果。
        """
        try:
            await asyncio.wait_for(self._gate.wait(), timeout=_APPLY_CONFIRM_TIMEOUT)
        except TimeoutError:
            outcome = DECISION_DISCONNECTED if self._client_gone else DECISION_TIMEOUT
            logger.warning(
                "apply 确认超时(%ds)，自动兜底 %s: request_id=%s",
                int(_APPLY_CONFIRM_TIMEOUT),
                outcome,
                self.request_id,
            )
            return {"decision": outcome}
        return {"decision": self._decision or DECISION_REJECT}

    async def await_decision(self) -> str:
        """阻塞等待用户决策，返回 decision 字符串("confirm" 或 "reject")。

        向后兼容入口：生产链路已全部迁移 await_outcome()（apply_actions 文案需要
        区分兜底原因），本方法无生产调用方，保留给外部脚本与存量测试——
        timeout/disconnected 兜底结果统一折叠为 "reject"（不写盘的保守语义）。
        """
        outcome = await self.await_outcome()
        return outcome["decision"] if outcome["decision"] in (DECISION_CONFIRM, DECISION_REJECT) else DECISION_REJECT

    async def resolve(self, decision: str) -> None:
        """唤醒协程并写入用户决策。已决议则忽略(幂等)。"""
        async with self._resolve_lock:
            if self._gate.is_set():
                return
            self._decision = decision
            self._gate.set()

    async def resolve_disconnected(self) -> None:
        """系统侧终止（任务取消/销毁）时唤醒：决策记为 disconnected，非用户决策。

        供 orchestrator 兜底清理调用——此时用户并未选择拒绝，
        文案必须与"用户拒绝"区分。
        """
        async with self._resolve_lock:
            if self._gate.is_set():
                return
            self._decision = DECISION_DISCONNECTED
            self._gate.set()

    def mark_client_gone(self) -> None:
        """标记 SSE 客户端已断开（断开时由 stream 层调用，影响超时兜底的判定）。"""
        self._client_gone = True

    @property
    def is_resolved(self) -> bool:
        return self._gate.is_set()

    @property
    def decision(self) -> str | None:
        return self._decision


class InteractionController:
    """@classdesc 通用交互门控制器（ask_user 专用）

    与 ConfirmController 的区别：
    - ConfirmController: 二元 confirm/reject，await_outcome() 返回结构化决策
    - InteractionController: 任意 dict response，await_response() 返回 dict

    在 ask_user 协程内创建，调用 await_response() 挂起协程。
    /respond 端点调用 resolve(response) 唤醒协程。
    超时自动返回 {skipped: true, reason: timeout|disconnected}。
    """

    def __init__(self, request_id: str, pending_payload: dict[str, Any] | None = None) -> None:
        self.request_id = request_id
        self.pending_payload = pending_payload  # question schema（发给前端的提问内容）
        self._gate = asyncio.Event()
        self._response: dict[str, Any] | None = None
        self._resolve_lock = asyncio.Lock()
        # SSE 客户端失联标记：断开后置位，超时兜底时据此区分 timeout 与 disconnected
        self._client_gone = False

    async def await_response(self) -> dict[str, Any]:
        """阻塞等待用户回答，返回 response dict。

        带 5 分钟超时：超时返回 {skipped: true, reason: timeout|disconnected}
        （reason=disconnected 表示 SSE 客户端已断开，非用户主动跳过），
        让 LLM 统一按 skip 处理、前端按 reason 渲染准确文案。
        """
        try:
            await asyncio.wait_for(self._gate.wait(), timeout=_INTERACTION_TIMEOUT)
        except TimeoutError:
            reason = DECISION_DISCONNECTED if self._client_gone else DECISION_TIMEOUT
            logger.warning(
                "ask 等待超时(%ds)，自动 skip (reason=%s): request_id=%s",
                int(_INTERACTION_TIMEOUT),
                reason,
                self.request_id,
            )
            return {"skipped": True, "reason": reason}
        return self._response or {"skipped": True, "reason": "empty"}

    async def resolve(self, response: dict[str, Any]) -> None:
        """唤醒协程并写入回答。已决议则忽略(幂等)。"""
        async with self._resolve_lock:
            if self._gate.is_set():
                return
            self._response = response
            self._gate.set()

    def mark_client_gone(self) -> None:
        """标记 SSE 客户端已断开（断开时由 stream 层调用，影响超时兜底的判定）。"""
        self._client_gone = True

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
    def mark_job_client_gone(self, job_id: str) -> None: ...


# 客户端失联登记的容量上限（FIFO 淘汰）：
# 正常路径下登记随 job 终态清理（pop_by_job_prefix），此处上限只兜底极端场景——
# 客户端在终态帧投递瞬间断开时，登记可能晚于 job 清理而残留（永不复用的 uuid 字符串）。
# 超限淘汰最旧条目，最坏影响仅是该 job 后续交互的超时兜底退化为 timeout 判定，无正确性风险
_MAX_CLIENT_GONE_JOBS = 512


class InMemoryPendingInteractionStore:
    """进程内 dict 实现（apply + ask 共用）。

    键命名（统一加类型前缀）：
    - apply: "{job_id}#apply#{seq}"
    - ask:   "{job_id}#ask#{seq}"

    兼容回退：get/pop 传入 job_id 时，找该 job 下唯一未决议项
    （匹配 f"{job_id}#" 前缀，覆盖 apply 和 ask 两类）。

    客户端失联登记：mark_job_client_gone 记录 job_id 并标记其现有 controller；
    该 job 之后新建的 controller（断开后任务继续运行、LLM 再次发起 apply/ask）
    在 put 时即被标记。pop_by_job_prefix（任务终态清理路径）注销登记；
    登记集合带 FIFO 容量上限，防极端时序下的残留累积。
    """

    def __init__(self) -> None:
        self._store: dict[str, ConfirmController | InteractionController] = {}
        self._lock = threading.Lock()
        # dict 充当有序集合（插入序即 FIFO 序），便于超限淘汰最旧登记
        self._client_gone_jobs: dict[str, None] = {}

    def put(self, interaction_id: str, controller: ConfirmController | InteractionController) -> None:
        with self._lock:
            # 该 job 的 SSE 客户端已断开 → 新 controller 出生即标记，
            # 使其超时兜底按 disconnected（而非 timeout）回灌
            job_prefix = interaction_id.split("#", 1)[0]
            if job_prefix in self._client_gone_jobs:
                controller.mark_client_gone()
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
        """弹出某 job 下所有挂起的 controller，并注销该 job 的客户端失联登记。"""
        with self._lock:
            prefix = f"{job_id}#"
            matched = [(aid, c) for aid, c in self._store.items() if aid.startswith(prefix)]
            for aid, _ in matched:
                self._store.pop(aid, None)
            # 任务终态清理路径（orchestrator finally / cancel 端点）调用本方法：
            # job 生命周期结束，失联登记随之注销（job_id 为 uuid 不复用，防集合泄漏）
            self._client_gone_jobs.pop(job_id, None)
            return [c for _, c in matched]

    def mark_job_client_gone(self, job_id: str) -> None:
        """登记某 job 的 SSE 客户端已断开，并标记其现有挂起 controller。

        断开不取消任务（宽限期）：只影响等待中交互的超时兜底判定——
        超时后按 disconnected（连接中断）而非 timeout（等待超时）回灌文案。
        """
        with self._lock:
            # 重复登记刷新 FIFO 位置（job 仍活跃，不应被淘汰）
            self._client_gone_jobs.pop(job_id, None)
            self._client_gone_jobs[job_id] = None
            while len(self._client_gone_jobs) > _MAX_CLIENT_GONE_JOBS:
                oldest = next(iter(self._client_gone_jobs))
                self._client_gone_jobs.pop(oldest)
            prefix = f"{job_id}#"
            for aid, controller in self._store.items():
                if aid.startswith(prefix):
                    controller.mark_client_gone()


_global_store: PendingInteractionStore = InMemoryPendingInteractionStore()


def get_global_pending_interaction_store() -> PendingInteractionStore:
    """获取全局 PendingInteractionStore 单例。"""
    return _global_store
