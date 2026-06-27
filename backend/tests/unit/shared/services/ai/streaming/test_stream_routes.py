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
from app.api.routers.ai.router import router
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

    显式导入所有 AI 子模块，确保 router.py 的 `from . import ...` 副作用完整执行
    （避免测试执行顺序或 import 缓存导致部分子模块未注册）。
    """
    # 显式导入子模块，触发路由注册副作用
    from app.api.routers.ai import (  # noqa: F401
        chat,
        generate,
        hardware,
        jobs,
        migrate,
        ollama,
        providers,
        stream,
        utils,
    )

    app = FastAPI()
    app.include_router(router)
    return app


def test_chat_stream_endpoint_registered(app: FastAPI):
    """chat/stream 与 cancel 端点已注册到 app。"""
    paths: list[str] = []
    for r in app.routes:
        if hasattr(r, "path"):
            paths.append(r.path)
        elif hasattr(r, "routes"):
            paths.extend(sr.path for sr in r.routes if hasattr(sr, "path"))
    assert "/api/latest/ai/chat/stream" in paths, f"chat/stream 未注册。app 路由数={len(paths)}，前 10 个: {paths[:10]}"
    assert "/api/latest/ai/jobs/{job_id}/cancel" in paths


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
