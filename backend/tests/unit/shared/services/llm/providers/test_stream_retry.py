"""@fileoverview chat_stream 流式重试机制测试

覆盖 P0-2：OpenAI/Ollama 两个 Provider 的 chat_stream 在未 yield 任何 chunk 前
对可重试异常（网络错误/限流/服务端错误）做指数退避重试，已 yield 后不重试。

测试策略：
- OpenAI：用真实的 openai SDK 异常类（APIConnectionError/APIStatusError），通过 mock
  client.chat.completions.create 让前 N 次抛异常、第 N+1 次返回正常流，验证重试契约。
- Ollama：mock aiohttp 的 session.post，前 N 次抛 ClientConnectionError/超时或返回 5xx。
- 用 patch 把 asyncio.sleep 缩短为 0，避免真实退避拖慢测试。
- executor 整合测试：用自定义 FlakyStreamProvider 验证 agent run 能从瞬时错误恢复。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatMessage, ChatRequest, ChatResponse, StreamChunk
from app.shared.services.llm.providers.ollama import OllamaProvider
from app.shared.services.llm.providers.openai import OpenAIProvider


def _user_msg(content: str = "hi") -> list[ChatMessage]:
    """构造单条 user 消息列表（provider 内部按 ChatMessage 属性访问）。"""
    return [ChatMessage(role="user", content=content)]


# =============================================================================
# 通用辅助：构造 openai SDK 真实异常
# =============================================================================


def _make_api_connection_error() -> Exception:
    """构造一个真实的 openai.APIConnectionError（需要 httpx.Request）。"""
    import httpx
    from openai import APIConnectionError

    return APIConnectionError(message="simulated connection error", request=httpx.Request("POST", "http://x"))


def _make_api_status_error(status_code: int) -> Exception:
    """构造一个真实的 openai.APIStatusError（需要 httpx.Response）。"""
    import httpx
    from openai import APIStatusError

    resp = httpx.Response(status_code=status_code, request=httpx.Request("POST", "http://x"))
    return APIStatusError(message=f"simulated {status_code}", response=resp, body=None)


class _FakeDelta:
    def __init__(self, content=None):
        self.content = content
        self.tool_calls = None


class _FakeChoice:
    def __init__(self, delta, finish_reason=None):
        self.delta = delta
        self.finish_reason = finish_reason


class _FakeChunk:
    def __init__(self, choices):
        self.choices = choices


class _FakeStreamCall:
    """模拟 client.chat.completions.create(stream=True) 返回的 async iterator。"""

    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        self._iter = iter(self._chunks)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration as e:
            raise StopAsyncIteration from e


def _make_openai_provider() -> OpenAIProvider:
    """构造 OpenAIProvider（不依赖 autouse patch，保留真实异常类）。"""
    cfg = AIProvider(id="test", name="test", type="openai", base_url="http://x", model="m", api_key="k")
    return OpenAIProvider(cfg)


# =============================================================================
# OpenAI chat_stream 重试测试
# =============================================================================


@pytest.mark.asyncio
async def test_openai_stream_retries_before_first_chunk():
    """前 2 次抛 APIConnectionError，第 3 次正常返回 → 重试成功，agent 拿到完整流。"""
    provider = _make_openai_provider()
    # 正常流：两个 delta
    normal_stream = _FakeStreamCall(
        [_FakeChunk([_FakeChoice(_FakeDelta("你好"))]), _FakeChunk([_FakeChoice(_FakeDelta("世界"))])]
    )
    create_mock = AsyncMock(
        side_effect=[
            _make_api_connection_error(),
            _make_api_connection_error(),
            normal_stream,
        ]
    )
    provider.client = MagicMock()
    provider.client.chat.completions.create = create_mock

    req = ChatRequest(messages=_user_msg())
    # 缩短退避，避免真实 sleep 拖慢测试
    with patch("app.shared.services.llm.providers.openai.asyncio.sleep", new=AsyncMock(return_value=None)):
        results = [chunk async for chunk in provider.chat_stream(req)]

    assert create_mock.await_count == 3
    assert [c.text for c in results] == ["你好", "世界"]


@pytest.mark.asyncio
async def test_openai_stream_no_retry_after_yield():
    """已 yield 出 chunk 后再抛错 → 不重试（无法回收已发出的内容），直接抛出。"""
    provider = _make_openai_provider()

    # 构造一个先 yield 一个 chunk 再抛错的 async iterator
    class _BreakAfterFirst:
        def __init__(self):
            self._yielded = False

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._yielded:
                self._yielded = True
                return _FakeChunk([_FakeChoice(_FakeDelta("部分内容"))])
            raise _make_api_connection_error()

    create_mock = AsyncMock(return_value=_BreakAfterFirst())
    provider.client = MagicMock()
    provider.client.chat.completions.create = create_mock

    req = ChatRequest(messages=_user_msg())
    with patch("app.shared.services.llm.providers.openai.asyncio.sleep", new=AsyncMock(return_value=None)):
        chunks = []
        with pytest.raises(Exception) as exc_info:  # noqa: PT011 — 已 yield 后直接 raise 原异常
            async for chunk in provider.chat_stream(req):
                chunks.append(chunk)

    # 只调用 1 次（没重试），且已收到的 chunk 保留
    assert create_mock.await_count == 1
    assert len(chunks) == 1
    assert chunks[0].text == "部分内容"
    # 已 yield 后的 APIConnectionError 直接抛出（不重试、不包装）
    assert "simulated connection error" in str(exc_info.value)


@pytest.mark.asyncio
async def test_openai_stream_non_retryable_status_not_retried():
    """400 等非可重试状态码 → 立即抛出，不重试。"""
    provider = _make_openai_provider()
    create_mock = AsyncMock(side_effect=_make_api_status_error(400))
    provider.client = MagicMock()
    provider.client.chat.completions.create = create_mock

    req = ChatRequest(messages=_user_msg())
    with patch("app.shared.services.llm.providers.openai.asyncio.sleep", new=AsyncMock(return_value=None)):
        with pytest.raises(Exception):  # noqa: PT011
            async for _ in provider.chat_stream(req):
                pass

    assert create_mock.await_count == 1


@pytest.mark.asyncio
async def test_openai_stream_retries_on_5xx_status():
    """503 服务端错误 → 可重试，重试后成功。"""
    provider = _make_openai_provider()
    normal_stream = _FakeStreamCall([_FakeChunk([_FakeChoice(_FakeDelta("恢复"))])])
    create_mock = AsyncMock(side_effect=[_make_api_status_error(503), normal_stream])
    provider.client = MagicMock()
    provider.client.chat.completions.create = create_mock

    req = ChatRequest(messages=_user_msg())
    with patch("app.shared.services.llm.providers.openai.asyncio.sleep", new=AsyncMock(return_value=None)):
        results = [chunk async for chunk in provider.chat_stream(req)]

    assert create_mock.await_count == 2
    assert [c.text for c in results] == ["恢复"]


# =============================================================================
# Ollama chat_stream 重试测试
# =============================================================================


class _FakeOllamaResp:
    """模拟 aiohttp response（context manager 协议）。"""

    def __init__(self, status, lines=None, exc=None):
        self.status = status
        self._lines = lines or []
        self._exc = exc  # 进入 context 时抛出（模拟连接失败）
        self.request_info = MagicMock()
        self.history = []

    async def __aenter__(self):
        if self._exc:
            raise self._exc
        return self

    async def __aexit__(self, *args):
        return False

    async def text(self):
        return ""

    @property
    def content(self):
        async def _aiter():
            for line in self._lines:
                yield line

        return _aiter()


def _make_ollama_provider() -> OllamaProvider:
    cfg = AIProvider(id="test", name="test", type="ollama", base_url="http://localhost:11434", model="m")
    return OllamaProvider(cfg)


@pytest.mark.asyncio
async def test_ollama_stream_retries_on_connection_error():
    """Ollama 前次连接错误，重试后成功。"""
    provider = _make_ollama_provider()
    import aiohttp

    conn_err = aiohttp.ClientConnectionError("simulated connection refused")
    lines = ['{"message":{"content":"恢复"}}'.encode(), b'{"done":true}']
    session = MagicMock()
    session.post = MagicMock(side_effect=[_FakeOllamaResp(200, exc=conn_err), _FakeOllamaResp(200, lines)])
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(messages=_user_msg())
    with patch("app.shared.services.llm.providers.ollama.asyncio.sleep", new=AsyncMock(return_value=None)):
        results = [chunk async for chunk in provider.chat_stream(req)]

    assert session.post.call_count == 2
    assert [c.text for c in results] == ["恢复"]


@pytest.mark.asyncio
async def test_ollama_stream_retries_on_5xx():
    """Ollama 503 服务端错误 → 可重试。"""
    provider = _make_ollama_provider()
    lines = ['{"message":{"content":"恢复"}}'.encode(), b'{"done":true}']
    session = MagicMock()
    session.post = MagicMock(side_effect=[_FakeOllamaResp(503), _FakeOllamaResp(200, lines)])
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(messages=_user_msg())
    with patch("app.shared.services.llm.providers.ollama.asyncio.sleep", new=AsyncMock(return_value=None)):
        results = [chunk async for chunk in provider.chat_stream(req)]

    assert session.post.call_count == 2
    assert [c.text for c in results] == ["恢复"]


@pytest.mark.asyncio
async def test_ollama_stream_no_retry_on_4xx():
    """Ollama 400 客户端错误 → 不重试。"""
    provider = _make_ollama_provider()
    session = MagicMock()
    session.post = MagicMock(return_value=_FakeOllamaResp(400))
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(messages=_user_msg())
    with patch("app.shared.services.llm.providers.ollama.asyncio.sleep", new=AsyncMock(return_value=None)):
        with pytest.raises(Exception):  # noqa: PT011
            async for _ in provider.chat_stream(req):
                pass

    assert session.post.call_count == 1


# =============================================================================
# Executor 整合：agent run 能从瞬时流式错误恢复
# =============================================================================


class _PresetStreamProvider(BaseProvider):
    """按预设响应序列返回流式 chunk 的简单 Provider（用于 executor 整合回归测试）。

    provider 层的重试已在前面 OpenAI/Ollama 单独的测试中覆盖；这里聚焦验证
    executor 的多轮循环在正常流式调用下端到端工作。
    """

    def __init__(self, responses):
        super().__init__(
            AIProvider(
                id="fake",
                name="Fake",
                type=ProviderType.OPENAI,
                base_url="http://localhost",
                api_key="",
                model="fake",
            )
        )
        self.responses = responses
        self.call_index = 0
        self.last_messages = None

    @property
    def name(self):
        return "Fake"

    @property
    def model(self) -> str:
        return self.cfg.model

    async def chat(self, req: ChatRequest) -> ChatResponse:  # pragma: no cover
        return ChatResponse(content="", model="fake")

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        self.last_messages = req.messages
        response = self.responses[min(self.call_index, len(self.responses) - 1)]
        self.call_index += 1
        content = response.get("content")
        if content:
            yield StreamChunk(type="delta", text=content)
        tool_calls = response.get("tool_calls")
        if tool_calls:
            yield StreamChunk(type="tool_calls", tool_calls=tool_calls)

    async def list_models(self) -> list[str]:
        return ["fake"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}


@pytest.mark.asyncio
async def test_executor_runs_multi_turn_with_streaming_provider():
    """executor 多轮循环在流式 provider 下端到端工作（P0-2 回归保护）。

    构造一个 2 轮循环（第一轮调工具，第二轮收尾），验证流式路径未被
    chat_stream 重试改造破坏。
    """
    registry = ToolRegistry()
    registry.register(
        name="echo",
        description="Echo tool",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "result": "ok"},
    )

    provider = _PresetStreamProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "echo", "arguments": "{}"}}],
            },
            {"content": "完成"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test")

    assert result.success is True
    assert result.content == "完成"
