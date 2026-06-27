"""Ollama chat_stream 流式 tool_calls 支持测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.llm.config.models import AIProvider
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.ollama import OllamaProvider


@pytest.fixture(autouse=True)
def _mock_aiohttp():
    """确保 _aiohttp 不为 None，绕过 chat_stream 的导入守卫。"""
    with patch("app.shared.services.llm.providers.ollama._aiohttp", MagicMock()):
        yield


def _make_provider() -> OllamaProvider:
    cfg = AIProvider(id="test", name="test", type="ollama", base_url="http://localhost:11434", model="m")
    return OllamaProvider(cfg)


class _FakeResp:
    """模拟 aiohttp response。"""

    def __init__(self, status, lines):
        self.status = status
        self._lines = lines
        self.request_info = MagicMock()
        self.history = []

    async def __aenter__(self):
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


@pytest.mark.asyncio
async def test_ollama_stream_text():
    """纯文本流。"""
    provider = _make_provider()
    lines = [
        '{"message":{"content":"你好"}}'.encode(),
        '{"message":{"content":"世界"}}'.encode(),
        b'{"done":true}',
    ]
    session = MagicMock()
    session.post = MagicMock(return_value=_FakeResp(200, lines))
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    assert len(results) == 2
    assert results[0].type == "delta" and results[0].text == "你好"
    assert results[1].type == "delta" and results[1].text == "世界"


@pytest.mark.asyncio
async def test_ollama_stream_tool_calls():
    """Ollama tool_calls 在单 chunk 完整体到达。"""
    provider = _make_provider()
    tc_payload = (
        b'{"message":{"content":"","tool_calls":'
        b'[{"id":"call_1","function":{"name":"apply_actions","arguments":"{\\"actions\\":[1]}"}}]}}'
    )
    lines = [tc_payload, b'{"done":true}']
    session = MagicMock()
    session.post = MagicMock(return_value=_FakeResp(200, lines))
    provider._get_session = AsyncMock(return_value=session)

    req = ChatRequest(
        messages=[ChatMessage(role="user", content="do")],
        tools=[{"type": "function", "function": {"name": "apply_actions"}}],
    )
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1
    tcs = tc_chunks[0].tool_calls
    assert len(tcs) == 1
    assert tcs[0]["id"] == "call_1"
    assert tcs[0]["function"]["name"] == "apply_actions"
