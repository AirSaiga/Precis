"""CachedProvider 装饰器单元测试"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.shared.services.llm.cache.response_cache import ResponseCache
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import (
    BaseProvider,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    StreamChunk,
)
from app.shared.services.llm.providers.cached_provider import CachedProvider

# ── Fake provider ────────────────────────────────────────────────────────────


class FakeProvider(BaseProvider):
    """可控的 fake provider，记录调用次数。"""

    def __init__(self, config: AIProvider | None = None):
        if config is None:
            config = AIProvider(
                id="fake",
                name="Fake",
                type=ProviderType.OPENAI,
                base_url="http://localhost",
                model="fake-model",
            )
        super().__init__(config)
        self.chat_call_count = 0
        self.stream_call_count = 0
        self._chat_response = ChatResponse(content="cached!", model="fake-model")
        self._stream_chunks = [
            StreamChunk(type="delta", text="hel"),
            StreamChunk(type="delta", text="lo"),
            StreamChunk(type="tool_calls", tool_calls=[{"id": "c1"}]),
        ]

    @property
    def name(self) -> str:
        return "Fake"

    @property
    def model(self) -> str:
        return self.cfg.model

    async def chat(self, req: ChatRequest) -> ChatResponse:
        self.chat_call_count += 1
        return self._chat_response

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        self.stream_call_count += 1
        for c in self._stream_chunks:
            yield c

    async def list_models(self) -> list[str]:
        return ["model-a", "model-b"]

    async def health(self) -> dict[str, Any]:
        return {"status": "ok"}


# ── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def fake() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def cache() -> ResponseCache:
    return ResponseCache(max_entries=100, ttl_seconds=60)


@pytest.fixture
def cached(fake: FakeProvider, cache: ResponseCache) -> CachedProvider:
    return CachedProvider(fake, cache)


def _req(content: str = "hi", temperature: float = 0.0) -> ChatRequest:
    return ChatRequest(
        messages=[ChatMessage(role="user", content=content)],
        model="fake-model",
        temperature=temperature,
    )


# ── chat ─────────────────────────────────────────────────────────────────────


class TestCachedProviderChat:
    @pytest.mark.asyncio
    async def test_miss_calls_real_and_caches(self, cached: CachedProvider, fake: FakeProvider):
        resp = await cached.chat(_req())
        assert resp.content == "cached!"
        assert fake.chat_call_count == 1

    @pytest.mark.asyncio
    async def test_hit_skips_real(self, cached: CachedProvider, fake: FakeProvider):
        await cached.chat(_req())
        await cached.chat(_req())
        assert fake.chat_call_count == 1  # 只调了一次

    @pytest.mark.asyncio
    async def test_different_content_misses(self, cached: CachedProvider, fake: FakeProvider):
        await cached.chat(_req(content="a"))
        await cached.chat(_req(content="b"))
        assert fake.chat_call_count == 2

    @pytest.mark.asyncio
    async def test_temperature_above_zero_not_cached_by_default(self, cached: CachedProvider, fake: FakeProvider):
        await cached.chat(_req(temperature=0.7))
        await cached.chat(_req(temperature=0.7))
        assert fake.chat_call_count == 2  # 每次都调

    @pytest.mark.asyncio
    async def test_temperature_above_zero_cached_when_enabled(self, fake: FakeProvider, cache: ResponseCache):
        cached = CachedProvider(fake, cache, cache_temperature_above_zero=True)
        await cached.chat(_req(temperature=0.7))
        await cached.chat(_req(temperature=0.7))
        assert fake.chat_call_count == 1

    @pytest.mark.asyncio
    async def test_empty_response_not_cached(self, fake: FakeProvider, cache: ResponseCache):
        fake._chat_response = ChatResponse(content=None, tool_calls=None, model="fake-model")
        cached = CachedProvider(fake, cache)
        await cached.chat(_req())
        await cached.chat(_req())
        assert fake.chat_call_count == 2  # 空响应不缓存

    @pytest.mark.asyncio
    async def test_tool_calls_response_cached(self, fake: FakeProvider, cache: ResponseCache):
        fake._chat_response = ChatResponse(content=None, tool_calls=[{"id": "c1"}], model="fake-model")
        cached = CachedProvider(fake, cache)
        await cached.chat(_req())
        await cached.chat(_req())
        assert fake.chat_call_count == 1


# ── chat_stream ──────────────────────────────────────────────────────────────


class TestCachedProviderStream:
    @pytest.mark.asyncio
    async def test_miss_records_and_yields(self, cached: CachedProvider, fake: FakeProvider):
        chunks = [c async for c in cached.chat_stream(_req())]
        assert len(chunks) == 3
        assert chunks[0].text == "hel"
        assert fake.stream_call_count == 1

    @pytest.mark.asyncio
    async def test_hit_replays_cached(self, cached: CachedProvider, fake: FakeProvider):
        # 第一次：未命中
        chunks1 = [c async for c in cached.chat_stream(_req())]
        # 第二次：命中
        chunks2 = [c async for c in cached.chat_stream(_req())]
        assert fake.stream_call_count == 1
        assert len(chunks1) == len(chunks2) == 3
        for c1, c2 in zip(chunks1, chunks2):
            assert c1.type == c2.type
            assert c1.text == c2.text
            assert c1.tool_calls == c2.tool_calls

    @pytest.mark.asyncio
    async def test_stream_temperature_above_zero_not_cached(self, cached: CachedProvider, fake: FakeProvider):
        req = _req(temperature=0.7)
        [c async for c in cached.chat_stream(req)]
        [c async for c in cached.chat_stream(req)]
        assert fake.stream_call_count == 2

    @pytest.mark.asyncio
    async def test_stream_empty_not_cached(self, fake: FakeProvider, cache: ResponseCache):
        call_count = 0

        async def empty_stream(req: ChatRequest) -> AsyncIterator[StreamChunk]:
            nonlocal call_count
            call_count += 1
            return
            yield  # pragma: no cover  # type: ignore[misc]

        fake.chat_stream = empty_stream  # type: ignore[assignment]
        cached = CachedProvider(fake, cache)
        [c async for c in cached.chat_stream(_req())]
        [c async for c in cached.chat_stream(_req())]
        assert call_count == 2


# ── passthrough ──────────────────────────────────────────────────────────────


class TestCachedProviderPassthrough:
    @pytest.mark.asyncio
    async def test_list_models_passthrough(self, cached: CachedProvider):
        models = await cached.list_models()
        assert models == ["model-a", "model-b"]

    @pytest.mark.asyncio
    async def test_health_passthrough(self, cached: CachedProvider):
        h = await cached.health()
        assert h == {"status": "ok"}

    def test_get_context_window_passthrough(self, cached: CachedProvider):
        result = cached.get_context_window()
        assert isinstance(result, int)

    def test_name_wraps_real(self, cached: CachedProvider):
        assert "Cached" in cached.name
        assert "Fake" in cached.name

    def test_model_delegates_to_real(self, cached: CachedProvider):
        assert cached.model == "fake-model"
