"""/respond 端点测试：回应用户的 ask_user 提问。

验证：
- 正常回答：resolve pending InteractionController
- 跳过回答：response 含 skipped
- ask_id 不存在返回 404
- 重复回答（已 resolved）幂等返回 already_resolved
- 类型不符（拿到 ConfirmController）返回 409
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    InteractionController,
    get_global_pending_interaction_store,
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def clean_store():
    """每个测试前后清理全局 store。"""
    store = get_global_pending_interaction_store()
    yield
    # 测试后清理：清空内部 _store
    if hasattr(store, "_store"):
        with store._lock:
            store._store.clear()


class TestRespondEndpoint:
    """POST /api/latest/ai/chat/{job_id}/respond"""

    def test_respond_resolves_pending_ask(self, client: TestClient) -> None:
        """正常回答：resolve pending InteractionController。"""
        store = get_global_pending_interaction_store()
        ctrl = InteractionController(request_id="job-1#ask#1")
        store.put("job-1#ask#1", ctrl)

        resp = client.post(
            "/api/latest/ai/chat/job-1/respond",
            json={"ask_id": "job-1#ask#1", "response": {"answer": "用 A 方案"}},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["already_resolved"] is False
        assert ctrl.is_resolved is True
        assert ctrl.response == {"answer": "用 A 方案"}

    def test_respond_skipped_answer(self, client: TestClient) -> None:
        """跳过回答：response 含 skipped。"""
        store = get_global_pending_interaction_store()
        ctrl = InteractionController(request_id="job-2#ask#1")
        store.put("job-2#ask#1", ctrl)

        resp = client.post(
            "/api/latest/ai/chat/job-2/respond",
            json={"ask_id": "job-2#ask#1", "response": {"skipped": True, "reason": "user_skipped"}},
        )

        assert resp.status_code == 200
        assert ctrl.response == {"skipped": True, "reason": "user_skipped"}

    def test_respond_nonexistent_ask_returns_404(self, client: TestClient) -> None:
        """ask_id 不存在返回 404。"""
        resp = client.post(
            "/api/latest/ai/chat/job-x/respond",
            json={"ask_id": "job-x#ask#999", "response": {"answer": "x"}},
        )
        assert resp.status_code == 404

    def test_respond_already_resolved_is_idempotent(self, client: TestClient) -> None:
        """重复回答（已 resolved）返回 200 + already_resolved=True，不覆盖原回答。"""
        store = get_global_pending_interaction_store()
        ctrl = InteractionController(request_id="job-3#ask#1")
        store.put("job-3#ask#1", ctrl)

        # 第一次回答
        resp1 = client.post(
            "/api/latest/ai/chat/job-3/respond",
            json={"ask_id": "job-3#ask#1", "response": {"answer": "first"}},
        )
        assert resp1.status_code == 200
        assert resp1.json()["already_resolved"] is False

        # 第二次回答（幂等，不覆盖）
        resp2 = client.post(
            "/api/latest/ai/chat/job-3/respond",
            json={"ask_id": "job-3#ask#1", "response": {"answer": "second"}},
        )
        assert resp2.status_code == 200
        assert resp2.json()["already_resolved"] is True
        assert ctrl.response == {"answer": "first"}  # 未被覆盖

    def test_respond_rejects_confirm_controller_with_409(self, client: TestClient) -> None:
        """ask_id 命中 ConfirmController（apply 类型）返回 409，不误 resolve。"""
        store = get_global_pending_interaction_store()
        ctrl = ConfirmController(request_id="job-4#apply#1")
        store.put("job-4#apply#1", ctrl)

        resp = client.post(
            "/api/latest/ai/chat/job-4/respond",
            json={"ask_id": "job-4#apply#1", "response": {"answer": "x"}},
        )
        assert resp.status_code == 409
        # ConfirmController 未被 resolve（响应是 dict，不应写入 str decision）
        assert ctrl.is_resolved is False
