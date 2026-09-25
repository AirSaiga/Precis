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
"""InteractionController 与 pending_interaction_store 单元测试。

覆盖：
- InteractionController: await_response 正常返回 / 超时返回 skipped / resolve 幂等 / 并发原子
- InMemoryPendingInteractionStore: apply/ask key 前缀并存、get_all_by_job、pop_by_job_prefix
- ConfirmController: 向后兼容仍可用（await_decision）
- ConfirmOutcome: await_outcome 结构化结果——用户决策(confirm/reject)与系统兜底(timeout/disconnected)三分支
- 客户端失联登记: mark_job_client_gone 标记现有/新建 controller、终态注销、容量上限
"""

from __future__ import annotations

import asyncio

import pytest

from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    InMemoryPendingInteractionStore,
    InteractionController,
    PendingInteractionStore,
    get_global_pending_interaction_store,
)


class TestInteractionController:
    """InteractionController: 通用交互门控（任意 dict response）。"""

    @pytest.mark.asyncio
    async def test_await_response_returns_resolved_value(self) -> None:
        """resolve 写入的 response 被 await_response 返回。"""
        ctrl = InteractionController(request_id="job-1#ask#1")
        await ctrl.resolve({"answer": "用 A 方案"})
        response = await ctrl.await_response()
        assert response == {"answer": "用 A 方案"}

    @pytest.mark.asyncio
    async def test_await_response_timeout_returns_skipped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """超时返回 {skipped: true, reason: timeout}。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_INTERACTION_TIMEOUT", 0.1)
        ctrl = InteractionController(request_id="job-1#ask#1")
        response = await ctrl.await_response()
        assert response == {"skipped": True, "reason": "timeout"}

    @pytest.mark.asyncio
    async def test_resolve_is_idempotent(self) -> None:
        """重复 resolve 只生效第一次（幂等）。"""
        ctrl = InteractionController(request_id="job-1#ask#1")
        await ctrl.resolve({"answer": "first"})
        await ctrl.resolve({"answer": "second"})  # 应被忽略
        assert ctrl.response == {"answer": "first"}
        assert ctrl.is_resolved is True

    @pytest.mark.asyncio
    async def test_concurrent_resolve_is_atomic(self) -> None:
        """并发 resolve 不会混合/丢失，最终 response 是其一。"""
        ctrl = InteractionController(request_id="job-1#ask#1")
        await asyncio.gather(ctrl.resolve({"answer": "A"}), ctrl.resolve({"answer": "B"}))
        assert ctrl.response in ({"answer": "A"}, {"answer": "B"})
        assert ctrl.is_resolved is True

    @pytest.mark.asyncio
    async def test_gather_await_then_resolve(self) -> None:
        """一个 task await，另一 task 延迟 resolve，验证唤醒。"""

        async def waiter(ctrl: InteractionController) -> dict:
            return await ctrl.await_response()

        async def resolver(ctrl: InteractionController) -> None:
            await asyncio.sleep(0.05)
            await ctrl.resolve({"answer": "delayed"})

        ctrl = InteractionController(request_id="job-1#ask#1")
        results = await asyncio.gather(waiter(ctrl), resolver(ctrl))
        assert results[0] == {"answer": "delayed"}


class TestInMemoryPendingInteractionStore:
    """store 同时存 apply/ask 两类 controller，靠 key 前缀区分。"""

    def test_put_and_get_ask_controller(self) -> None:
        store = InMemoryPendingInteractionStore()
        ctrl = InteractionController(request_id="job-1#ask#1")
        store.put("job-1#ask#1", ctrl)
        assert store.get("job-1#ask#1") is ctrl

    def test_put_and_get_apply_controller(self) -> None:
        store = InMemoryPendingInteractionStore()
        ctrl = ConfirmController(request_id="job-1#apply#1")
        store.put("job-1#apply#1", ctrl)
        assert store.get("job-1#apply#1") is ctrl

    def test_apply_and_ask_coexist_independently(self) -> None:
        """同一 job 下 apply 和 ask controller 独立存取，互不干扰。"""
        store = InMemoryPendingInteractionStore()
        apply_ctrl = ConfirmController(request_id="job-1#apply#1")
        ask_ctrl = InteractionController(request_id="job-1#ask#1")
        store.put("job-1#apply#1", apply_ctrl)
        store.put("job-1#ask#1", ask_ctrl)
        assert store.get("job-1#apply#1") is apply_ctrl
        assert store.get("job-1#ask#1") is ask_ctrl

    def test_pop_removes_controller(self) -> None:
        store = InMemoryPendingInteractionStore()
        ctrl = InteractionController(request_id="job-1#ask#1")
        store.put("job-1#ask#1", ctrl)
        assert store.pop("job-1#ask#1") is ctrl
        assert store.get("job-1#ask#1") is None

    def test_get_all_by_job_returns_both_types(self) -> None:
        """get_all_by_job 按 job 前缀返回 apply+ask 所有 controller。"""
        store = InMemoryPendingInteractionStore()
        store.put("job-1#apply#1", ConfirmController(request_id="job-1#apply#1"))
        store.put("job-1#ask#1", InteractionController(request_id="job-1#ask#1"))
        all_ctrls = store.get_all_by_job("job-1")
        assert len(all_ctrls) == 2

    def test_pop_by_job_prefix_clears_all(self) -> None:
        store = InMemoryPendingInteractionStore()
        store.put("job-1#apply#1", ConfirmController(request_id="job-1#apply#1"))
        store.put("job-1#ask#1", InteractionController(request_id="job-1#ask#1"))
        popped = store.pop_by_job_prefix("job-1")
        assert len(popped) == 2
        assert store.get("job-1#apply#1") is None
        assert store.get("job-1#ask#1") is None

    def test_get_nonexistent_returns_none(self) -> None:
        store = InMemoryPendingInteractionStore()
        assert store.get("nope") is None


class TestConfirmControllerBackwardCompat:
    """ConfirmController 向后兼容（apply 代码仍用，行为不变）。"""

    @pytest.mark.asyncio
    async def test_await_decision_returns_confirm(self) -> None:
        ctrl = ConfirmController(request_id="job-1#apply#1")
        await ctrl.resolve("confirm")
        assert await ctrl.await_decision() == "confirm"

    @pytest.mark.asyncio
    async def test_await_decision_timeout_returns_reject(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.1)
        ctrl = ConfirmController(request_id="job-1#apply#1")
        assert await ctrl.await_decision() == "reject"


class TestConfirmOutcomeBranches:
    """await_outcome 结构化结果：区分用户决策与系统兜底（超时/断连）。"""

    @pytest.mark.asyncio
    async def test_user_confirm_returns_confirm(self) -> None:
        """用户显式 confirm → {"decision": "confirm"}。"""
        ctrl = ConfirmController(request_id="job-1#apply#1")
        await ctrl.resolve("confirm")
        assert await ctrl.await_outcome() == {"decision": "confirm"}

    @pytest.mark.asyncio
    async def test_user_reject_returns_reject(self) -> None:
        """用户显式 reject → {"decision": "reject"}（非兜底值）。"""
        ctrl = ConfirmController(request_id="job-1#apply#1")
        await ctrl.resolve("reject")
        assert await ctrl.await_outcome() == {"decision": "reject"}

    @pytest.mark.asyncio
    async def test_timeout_without_disconnect_returns_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """客户端仍连接时超时 → {"decision": "timeout"}（用户未响应，非拒绝）。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        ctrl = ConfirmController(request_id="job-1#apply#1")
        assert await ctrl.await_outcome() == {"decision": "timeout"}

    @pytest.mark.asyncio
    async def test_timeout_with_client_gone_returns_disconnected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """客户端已断开（mark_client_gone）后超时 → {"decision": "disconnected"}。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        ctrl = ConfirmController(request_id="job-1#apply#1")
        ctrl.mark_client_gone()
        assert await ctrl.await_outcome() == {"decision": "disconnected"}

    @pytest.mark.asyncio
    async def test_await_decision_folds_fallbacks_to_reject(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """兼容入口 await_decision 把 timeout/disconnected 兜底折叠为 reject（保守不写盘）。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        ctrl = ConfirmController(request_id="job-1#apply#1")
        assert await ctrl.await_decision() == "reject"

        ctrl_gone = ConfirmController(request_id="job-1#apply#2")
        ctrl_gone.mark_client_gone()
        assert await ctrl_gone.await_decision() == "reject"

    @pytest.mark.asyncio
    async def test_resolve_disconnected_wakes_with_disconnected(self) -> None:
        """系统侧终止（resolve_disconnected）唤醒 → decision=disconnected，非用户决策。"""
        ctrl = ConfirmController(request_id="job-1#apply#1")
        await ctrl.resolve_disconnected()
        assert await ctrl.await_outcome() == {"decision": "disconnected"}
        assert ctrl.decision == "disconnected"

    @pytest.mark.asyncio
    async def test_resolve_disconnected_is_idempotent_against_user_decision(self) -> None:
        """用户已决议后，系统兜底 resolve_disconnected 不覆盖用户决策。"""
        ctrl = ConfirmController(request_id="job-1#apply#1")
        await ctrl.resolve("confirm")
        await ctrl.resolve_disconnected()  # 应被忽略
        assert await ctrl.await_outcome() == {"decision": "confirm"}


class TestInteractionDisconnected:
    """InteractionController 超时兜底区分 timeout 与 disconnected。"""

    @pytest.mark.asyncio
    async def test_timeout_with_client_gone_returns_disconnected_reason(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """客户端断开后超时 → {skipped: true, reason: disconnected}。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_INTERACTION_TIMEOUT", 0.05)
        ctrl = InteractionController(request_id="job-1#ask#1")
        ctrl.mark_client_gone()
        response = await ctrl.await_response()
        assert response == {"skipped": True, "reason": "disconnected"}


class TestClientGoneRegistry:
    """store 的客户端失联登记：标记现有 controller、标记断开后新建的 controller、终态注销。"""

    @pytest.mark.asyncio
    async def test_mark_job_client_gone_marks_existing_controllers(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """mark_job_client_gone 标记该 job 现有 controller——超时兜底判 disconnected。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        store = InMemoryPendingInteractionStore()
        ctrl = ConfirmController(request_id="job-1#apply#1")
        store.put("job-1#apply#1", ctrl)
        store.mark_job_client_gone("job-1")
        assert await ctrl.await_outcome() == {"decision": "disconnected"}

    @pytest.mark.asyncio
    async def test_put_after_mark_flags_newborn_controller(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """断开后任务继续运行、新建的 apply/ask controller 出生即带失联标记。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        store = InMemoryPendingInteractionStore()
        store.mark_job_client_gone("job-1")
        ctrl = ConfirmController(request_id="job-1#apply#2")
        store.put("job-1#apply#2", ctrl)
        assert await ctrl.await_outcome() == {"decision": "disconnected"}

    @pytest.mark.asyncio
    async def test_pop_by_job_prefix_clears_gone_registry(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """pop_by_job_prefix（任务终态清理）注销失联登记——之后新建 controller 不再被标记。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        monkeypatch.setattr(mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        store = InMemoryPendingInteractionStore()
        store.put("job-1#apply#1", ConfirmController(request_id="job-1#apply#1"))
        store.mark_job_client_gone("job-1")
        store.pop_by_job_prefix("job-1")

        ctrl = ConfirmController(request_id="job-1#apply#2")
        store.put("job-1#apply#2", ctrl)
        assert await ctrl.await_outcome() == {"decision": "timeout"}

    def test_gone_registry_is_bounded(self) -> None:
        """失联登记带 FIFO 容量上限（防极端时序残留累积）。"""
        import app.shared.services.ai.streaming.pending_interaction_store as mod

        store = InMemoryPendingInteractionStore()
        for i in range(mod._MAX_CLIENT_GONE_JOBS + 8):
            store.mark_job_client_gone(f"job-{i}")
        # 超限淘汰最旧条目后不超过上限
        assert len(store._client_gone_jobs) == mod._MAX_CLIENT_GONE_JOBS
        assert "job-0" not in store._client_gone_jobs
        assert f"job-{mod._MAX_CLIENT_GONE_JOBS + 7}" in store._client_gone_jobs


def test_global_store_singleton() -> None:
    s1 = get_global_pending_interaction_store()
    s2 = get_global_pending_interaction_store()
    assert s1 is s2
    assert isinstance(s1, InMemoryPendingInteractionStore)
    assert isinstance(s1, PendingInteractionStore)
