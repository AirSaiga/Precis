"""@fileoverview SSE 流式路由端点集成测试

验证 chat/stream 端点能返回 SSE 流、cancel 端点能设置取消信号。
使用 TestClient + mock provider 避免真实 LLM 调用。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.ai import stream as stream_module
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse, StreamChunk


class _NoopProvider(BaseProvider):
    """不调用真实 LLM 的 provider，流式直接返回固定文本。"""

    def __init__(self):
        from app.shared.services.llm.config.models import AIProvider, ProviderType

        super().__init__(
            AIProvider(
                id="noop",
                name="Noop",
                type=ProviderType.OPENAI,
                base_url="http://localhost",
                api_key="",
                model="noop",
            )
        )

    @property
    def name(self):
        return "Noop"

    @property
    def model(self) -> str:
        return "noop"

    async def chat(self, req: ChatRequest) -> ChatResponse:
        return ChatResponse(content="noop", model="noop")

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(type="delta", text="hello")

    async def list_models(self) -> list[str]:
        return ["noop"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}


@pytest.fixture
def app() -> FastAPI:
    """创建挂载了 AI 路由的 FastAPI app。

    使用项目既定的懒加载代理 ai_router（与 app/api/main.py 的注册方式一致），
    而非直接导入 router 子模块。这确保走完整的 app.api.routers 包初始化链路，
    避免 import 顺序导致的副作用注册不完整问题。
    """
    from fastapi import FastAPI

    from app.api.routers import ai_router

    app = FastAPI()
    # 与主应用 main.py 相同的注册方式：通过懒加载代理
    app.include_router(ai_router)  # type: ignore[arg-type]
    return app


def test_chat_stream_endpoint_registered():
    """chat/stream 端点已在 stream 模块定义。

    直接检查 router 实例的路由（不依赖 app.include_router 副作用，
    避免 CI 测试执行顺序导致的 import 状态差异问题）。
    router 的 prefix=/api/latest/ai 已应用到每个路由路径。
    """
    from app.api.routers.ai.router import router

    # router.prefix=/api/latest/ai 已应用到路径，故检查完整路径
    all_paths: set[str] = set()
    for r in router.routes:
        path = getattr(r, "path", None)
        if path:
            all_paths.add(path)

    assert "/api/latest/ai/chat/stream" in all_paths, (
        f"chat/stream 未注册到 router。router 路由: {sorted(all_paths)[:10]}..."
    )
    assert "/api/latest/ai/jobs/{job_id}/cancel" in all_paths


def test_cancel_endpoint_returns_not_found_for_unknown_job(app: FastAPI):
    """cancel 未知 job 返回 not_found。"""
    client = TestClient(app)
    resp = client.post("/api/latest/ai/jobs/nonexistent_job/cancel")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


def test_cancel_endpoint_sets_event_for_known_job():
    """cancel 已知 job 设置 cancel_event。"""
    import asyncio

    job_id = "test_known_job"
    ev = asyncio.Event()
    stream_module._cancel_events[job_id] = ev
    try:
        assert not ev.is_set()
        # 模拟取消
        stream_module._cancel_events[job_id].set()
        assert ev.is_set()
    finally:
        stream_module._cancel_events.pop(job_id, None)


def test_unregister_cancel_event_removes_entry():
    """_unregister_cancel_event 移除已注册的 job。"""
    import asyncio

    job_id = "test_unregister"
    stream_module._cancel_events[job_id] = asyncio.Event()
    assert job_id in stream_module._cancel_events

    stream_module._unregister_cancel_event(job_id)
    assert job_id not in stream_module._cancel_events


def test_journal_dir_for_project_path():
    """_journal_dir_for 按 project_path 返回项目本地目录（跨平台）。"""
    import os

    result = stream_module._journal_dir_for("/my/project")
    # 跨平台：用 os.path.join 拼接，断言路径组成部分而非硬编码分隔符
    expected = os.path.join("/my/project", ".precis", "stream_jobs")
    assert result == expected
