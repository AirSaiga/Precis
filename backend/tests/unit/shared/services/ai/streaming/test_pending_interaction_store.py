"""InteractionController 与 pending_interaction_store 单元测试。

覆盖：
- InteractionController: await_response 正常返回 / 超时返回 skipped / resolve 幂等 / 并发原子
- InMemoryPendingInteractionStore: apply/ask key 前缀并存、get_all_by_job、pop_by_job_prefix
- ConfirmController: 向后兼容仍可用
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


def test_global_store_singleton() -> None:
    s1 = get_global_pending_interaction_store()
    s2 = get_global_pending_interaction_store()
    assert s1 is s2
    assert isinstance(s1, InMemoryPendingInteractionStore)
    assert isinstance(s1, PendingInteractionStore)
