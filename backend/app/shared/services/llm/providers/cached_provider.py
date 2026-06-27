from __future__ import annotations

from collections.abc import AsyncIterator

from app.shared.services.llm.cache.response_cache import ResponseCache, cache_key

from .base import BaseProvider, ChatRequest, ChatResponse, StreamChunk


class CachedProvider(BaseProvider):
    """缓存装饰器：包装真实 provider，透明缓存 chat/chat_stream 响应。"""

    def __init__(
        self,
        real: BaseProvider,
        cache: ResponseCache,
        cache_temperature_above_zero: bool = False,
    ):
        self._real = real
        self._cache = cache
        self._cache_temp = cache_temperature_above_zero

    @property
    def name(self) -> str:
        return f"Cached({self._real.name})"

    @property
    def model(self) -> str:
        return self._real.model

    def _cacheable(self, req: ChatRequest) -> bool:
        """temperature > 0 默认不缓存（随机性），除非显式开启。"""
        return self._cache_temp or (req.temperature or 0) == 0

    async def chat(self, req: ChatRequest) -> ChatResponse:
        if not self._cacheable(req):
            return await self._real.chat(req)
        key = cache_key(req)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        resp = await self._real.chat(req)
        if resp.content or resp.tool_calls:
            self._cache.put(key, resp)
        return resp

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        if not self._cacheable(req):
            async for c in self._real.chat_stream(req):
                yield c
            return
        key = cache_key(req)
        cached = self._cache.get(key)
        if cached is not None:
            for c in cached:
                yield c
            return
        chunks: list[StreamChunk] = []
        async for c in self._real.chat_stream(req):
            chunks.append(c)
            yield c
        if chunks:
            self._cache.put(key, chunks)

    async def list_models(self) -> list[str]:
        return await self._real.list_models()

    async def health(self) -> dict:
        return await self._real.health()

    def get_context_window(self, model: str | None = None) -> int:
        return self._real.get_context_window(model)
