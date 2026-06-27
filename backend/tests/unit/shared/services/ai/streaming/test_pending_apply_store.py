"""@fileoverview ConfirmController + InMemoryPendingApplyStore 单元测试

覆盖：
- ConfirmController: await_decision, resolve(幂等), is_resolved, decision
- InMemoryPendingApplyStore: put/get/pop, 并发安全
"""

from __future__ import annotations

import asyncio
import threading
import time

from app.shared.services.ai.streaming.pending_apply_store import (
    ConfirmController,
    InMemoryPendingApplyStore,
    get_global_pending_store,
)


class TestConfirmController:
    def test_await_decision_resolves_to_confirm(self):
        """resolve("confirm") 后 await_decision 返回 "confirm"。"""
        ctrl = ConfirmController("job-1")

        async def _resolve_later():
            await asyncio.sleep(0.01)
            ctrl.resolve("confirm")

        async def _run():
            task = asyncio.create_task(_resolve_later())
            result = await ctrl.await_decision()
            await task
            return result

        assert asyncio.run(_run()) == "confirm"

    def test_await_decision_resolves_to_reject(self):
        """resolve("reject") 后 await_decision 返回 "reject"。"""
        ctrl = ConfirmController("job-2")

        async def _run():
            ctrl.resolve("reject")
            return await ctrl.await_decision()

        assert asyncio.run(_run()) == "reject"

    def test_await_decision_timeout_without_resolve(self):
        """不调用 resolve 时 await_decision 会一直挂起(超时测试)。"""
        ctrl = ConfirmController("job-3")

        async def _run():
            try:
                return await asyncio.wait_for(ctrl.await_decision(), timeout=0.05)
            except TimeoutError:
                return "timeout"

        assert asyncio.run(_run()) == "timeout"

    def test_resolve_is_idempotent(self):
        """多次 resolve 只生效第一次决策。"""
        ctrl = ConfirmController("job-4")
        ctrl.resolve("confirm")
        ctrl.resolve("reject")  # 第二次应被忽略
        assert ctrl.is_resolved is True
        assert ctrl.decision == "confirm"

    def test_is_resolved_false_before_resolve(self):
        """未决议时 is_resolved 为 False。"""
        ctrl = ConfirmController("job-5")
        assert ctrl.is_resolved is False
        assert ctrl.decision is None

    def test_decision_defaults_to_reject_on_gate_set_without_decision(self):
        """如果 gate 被意外 set 但 _decision 为 None,await_decision 返回 "reject"。"""
        ctrl = ConfirmController("job-6")
        ctrl._gate.set()
        assert asyncio.run(ctrl.await_decision()) == "reject"

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
        errors = []
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
