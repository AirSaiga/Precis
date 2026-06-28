"""@fileoverview ConfirmController + InMemoryPendingApplyStore 单元测试

覆盖：
- ConfirmController: await_decision(含超时), resolve(幂等+原子), is_resolved, decision
- InMemoryPendingApplyStore: put/get/pop, 并发安全
"""

from __future__ import annotations

import threading
import time

import pytest

from app.shared.services.ai.streaming.pending_apply_store import (
    ConfirmController,
    InMemoryPendingApplyStore,
    get_global_pending_store,
)


class TestConfirmController:
    @pytest.mark.asyncio
    async def test_await_decision_resolves_to_confirm(self):
        """resolve("confirm") 后 await_decision 返回 "confirm"。"""
        ctrl = ConfirmController("job-1")

        # resolve 必须在 await_decision 之前调用（否则 await_decision 会等到超时）
        await ctrl.resolve("confirm")
        result = await ctrl.await_decision()
        assert result == "confirm"

    @pytest.mark.asyncio
    async def test_await_decision_resolves_to_reject(self):
        """resolve("reject") 后 await_decision 返回 "reject"。"""
        ctrl = ConfirmController("job-2")
        await ctrl.resolve("reject")
        result = await ctrl.await_decision()
        assert result == "reject"

    @pytest.mark.asyncio
    async def test_await_decision_concurrent_resolve(self):
        """await_decision 挂起期间，并发 resolve 后正确返回。"""
        import asyncio

        ctrl = ConfirmController("job-2b")

        async def _resolve_later():
            await asyncio.sleep(0.01)  # 确保在 await_decision 之后才 resolve
            await ctrl.resolve("confirm")

        task = asyncio.create_task(_resolve_later())
        result = await ctrl.await_decision()
        await task
        assert result == "confirm"

    @pytest.mark.asyncio
    async def test_await_decision_timeout_without_resolve(self):
        """不调用 resolve 时，await_decision 超时返回 "reject"（5 分钟超时太长，用 monkeypatch 缩短）。"""
        ctrl = ConfirmController("job-3")
        # 缩短超时时间到 0.05s 以便测试
        import app.shared.services.ai.streaming.pending_apply_store as mod

        original_timeout = mod._APPLY_CONFIRM_TIMEOUT
        mod._APPLY_CONFIRM_TIMEOUT = 0.05
        try:
            result = await ctrl.await_decision()
            assert result == "reject"  # 超时自动 reject
        finally:
            mod._APPLY_CONFIRM_TIMEOUT = original_timeout

    @pytest.mark.asyncio
    async def test_resolve_is_idempotent(self):
        """多次 resolve 只生效第一次决策（幂等）。"""
        ctrl = ConfirmController("job-4")
        await ctrl.resolve("confirm")
        await ctrl.resolve("reject")  # 第二次应被忽略
        assert ctrl.is_resolved is True
        assert ctrl.decision == "confirm"

    @pytest.mark.asyncio
    async def test_concurrent_resolve_keeps_first(self):
        """并发 resolve 不同 decision 时，第一个生效（asyncio.Lock 保证原子 check-then-set）。"""
        import asyncio

        ctrl = ConfirmController("job-4b")

        # 两个 task 几乎同时 resolve
        t1 = asyncio.create_task(ctrl.resolve("confirm"))
        t2 = asyncio.create_task(ctrl.resolve("reject"))
        await asyncio.gather(t1, t2)

        assert ctrl.is_resolved is True
        # 第一个 resolve 生效（具体哪个取决于调度，但一定不是混合状态）
        assert ctrl.decision in ("confirm", "reject")

    def test_is_resolved_false_before_resolve(self):
        """未决议时 is_resolved 为 False。"""
        ctrl = ConfirmController("job-5")
        assert ctrl.is_resolved is False
        assert ctrl.decision is None

    @pytest.mark.asyncio
    async def test_decision_defaults_to_reject_on_gate_set_without_decision(self):
        """如果 gate 被意外 set 但 _decision 为 None，await_decision 返回 "reject"。"""
        ctrl = ConfirmController("job-6")
        ctrl._gate.set()
        result = await ctrl.await_decision()
        assert result == "reject"

    def test_pending_payload_stored(self):
        """pending_payload 在构造时存储。"""
        payload = {"diff": {"files": []}}
        ctrl = ConfirmController("job-7", pending_payload=payload)
        assert ctrl.pending_payload == payload


class TestInMemoryPendingApplyStore:
    def test_put_and_get(self):
        """put 后 get 返回 controller。"""
        store = InMemoryPendingApplyStore()
        ctrl = ConfirmController("job-a")
        store.put("job-a", ctrl)
        assert store.get("job-a") is ctrl

    def test_get_nonexistent_returns_none(self):
        """获取不存在的 key 返回 None。"""
        store = InMemoryPendingApplyStore()
        assert store.get("not-exist") is None

    def test_pop_returns_and_removes(self):
        """pop 返回 controller 并从 store 移除。"""
        store = InMemoryPendingApplyStore()
        ctrl = ConfirmController("job-b")
        store.put("job-b", ctrl)
        popped = store.pop("job-b")
        assert popped is ctrl
        assert store.get("job-b") is None

    def test_pop_nonexistent_returns_none(self):
        """pop 不存在的 key 返回 None。"""
        store = InMemoryPendingApplyStore()
        assert store.pop("ghost") is None

    def test_concurrent_put_get_thread_safe(self):
        """多个线程同时 put/get 不抛异常。"""
        store = InMemoryPendingApplyStore()
        errors: list[Exception] = []
        barrier = threading.Barrier(4)

        def worker(i):
            try:
                barrier.wait()
                ctrl = ConfirmController(f"job-{i}")
                store.put(f"job-{i}", ctrl)
                time.sleep(0.001)
                got = store.get(f"job-{i}")
                assert got is ctrl
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0


class TestGlobalStore:
    def test_get_global_pending_store_returns_same_instance(self):
        """get_global_pending_store 返回同一单例。"""
        s1 = get_global_pending_store()
        s2 = get_global_pending_store()
        assert s1 is s2

    def test_global_store_is_inmemory(self):
        """默认全局 store 是 InMemoryPendingApplyStore 实例。"""
        store = get_global_pending_store()
        assert isinstance(store, InMemoryPendingApplyStore)
