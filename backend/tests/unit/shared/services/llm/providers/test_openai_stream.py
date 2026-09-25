# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""OpenAI chat_stream 流式 tool_calls 支持测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.llm.config.models import AIProvider
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.openai import OpenAIProvider


@pytest.fixture(autouse=True)
def _mock_openai_deps():
    """确保 AsyncOpenAI 不为 None，绕过 OpenAIProvider.__init__ 的导入守卫。"""
    with (
        patch("app.shared.services.llm.providers.openai.AsyncOpenAI", MagicMock()),
        patch("app.shared.services.llm.providers.openai.APIConnectionError", Exception),
        patch("app.shared.services.llm.providers.openai.APIStatusError", Exception),
    ):
        yield


def _make_provider() -> OpenAIProvider:
    """构造 OpenAIProvider(provider 内部 client 会被 mock 替换)。"""
    cfg = AIProvider(id="test", name="test", type="openai", base_url="http://x", model="m", api_key="k")
    return OpenAIProvider(cfg)


class _FakeDelta:
    """模拟 OpenAI SDK 的 delta 对象。"""

    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


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
        except StopIteration:
            raise StopAsyncIteration


def _make_tc_delta(index, id_=None, name=None, args_fragment=None):
    """构造 tool_calls delta 分片。"""
    tc = MagicMock()
    tc.index = index
    func = MagicMock()
    func.name = name
    func.arguments = args_fragment
    tc.id = id_
    tc.function = func
    return tc


@pytest.mark.asyncio
async def test_stream_text_only():
    """纯文本流:多个 delta → 逐个 yield StreamChunk(type=delta)。"""
    provider = _make_provider()
    chunks = [
        _FakeChunk([_FakeChoice(_FakeDelta(content="你好"))]),
        _FakeChunk([_FakeChoice(_FakeDelta(content="世界"))]),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="stop")]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    assert len(results) == 2
    assert results[0].type == "delta" and results[0].text == "你好"
    assert results[1].type == "delta" and results[1].text == "世界"


@pytest.mark.asyncio
async def test_stream_tool_calls_accumulation():
    """tool_calls 分片累积:多个分片 → finish_reason=tool_calls 时一次性 yield 完整 tool_calls。"""
    provider = _make_provider()
    # 模拟分片到达:id/name 在首片,args 分 2 片到达
    chunks = [
        _FakeChunk(
            [
                _FakeChoice(
                    _FakeDelta(
                        tool_calls=[_make_tc_delta(0, id_="call_1", name="apply_actions", args_fragment='{"act')]
                    )
                )
            ]
        ),
        _FakeChunk([_FakeChoice(_FakeDelta(tool_calls=[_make_tc_delta(0, args_fragment='ions":[1]}')]))]),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="tool_calls")]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(
        messages=[ChatMessage(role="user", content="do")],
        tools=[{"type": "function", "function": {"name": "apply_actions"}}],
    )
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    # 应只有一个 tool_calls chunk
    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1
    tcs = tc_chunks[0].tool_calls
    assert len(tcs) == 1
    # 格式必须是 OpenAI 原始格式(parse_tool_call 期望)
    assert tcs[0]["id"] == "call_1"
    assert tcs[0]["function"]["name"] == "apply_actions"
    assert tcs[0]["function"]["arguments"] == '{"actions":[1]}'


@pytest.mark.asyncio
async def test_stream_flushes_accumulated_tool_calls_when_finish_is_stop():
    """vLLM 等兼容端点以 stop 收尾但不发 finish_reason=tool_calls → 流耗尽后必须补发累积的 tool_calls。

    不补发的话 executor 会误判本轮无工具调用，动作意图无痕迹消失。
    """
    provider = _make_provider()
    chunks = [
        _FakeChunk(
            [
                _FakeChoice(
                    _FakeDelta(
                        tool_calls=[_make_tc_delta(0, id_="call_1", name="read_table", args_fragment='{"table":"us')]
                    )
                )
            ]
        ),
        _FakeChunk([_FakeChoice(_FakeDelta(tool_calls=[_make_tc_delta(0, args_fragment='ers"}')]))]),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="stop")]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1, "stop 收尾但有累积 tool_calls 时，流耗尽后应补发恰好一次"
    tcs = tc_chunks[0].tool_calls
    assert tcs[0]["id"] == "call_1"
    assert tcs[0]["function"]["name"] == "read_table"
    assert tcs[0]["function"]["arguments"] == '{"table":"users"}'


@pytest.mark.asyncio
async def test_stream_flushes_accumulated_tool_calls_without_finish_reason():
    """端点最后一个 chunk 不带 finish_reason（None）→ 流耗尽后同样补发。"""
    provider = _make_provider()
    chunks = [
        _FakeChunk(
            [
                _FakeChoice(
                    _FakeDelta(
                        tool_calls=[_make_tc_delta(0, id_="call_2", name="validate_table", args_fragment='{"table')]
                    )
                )
            ]
        ),
        _FakeChunk([_FakeChoice(_FakeDelta(tool_calls=[_make_tc_delta(0, args_fragment='":"users"}')]))]),
        # 无 finish_reason 的收尾 chunk（部分网关直接结束流）
        _FakeChunk([_FakeChoice(_FakeDelta())]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1
    assert tc_chunks[0].tool_calls[0]["function"]["arguments"] == '{"table":"users"}'


@pytest.mark.asyncio
async def test_stream_tool_calls_finish_reason_no_duplicate_flush():
    """finish_reason=tool_calls 正常下发后 → 流耗尽兜底不得重复补发。"""
    provider = _make_provider()
    chunks = [
        _FakeChunk(
            [
                _FakeChoice(
                    _FakeDelta(tool_calls=[_make_tc_delta(0, id_="call_1", name="read_project", args_fragment="{}")])
                )
            ]
        ),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="tool_calls")]),
        # 收尾 chunk 之后流内还有空 chunk，再自然耗尽
        _FakeChunk([_FakeChoice(_FakeDelta())]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    tc_chunks = [c for c in results if c.type == "tool_calls"]
    assert len(tc_chunks) == 1, "已按 finish_reason=tool_calls 下发过，不得重复补发"


@pytest.mark.asyncio
async def test_stream_stop_without_accumulation_emits_no_tool_calls():
    """stop 收尾且无累积 tool_calls → 不产生任何 tool_calls chunk（纯文本流不受兜底影响）。"""
    provider = _make_provider()
    chunks = [
        _FakeChunk([_FakeChoice(_FakeDelta(content="你好"))]),
        _FakeChunk([_FakeChoice(_FakeDelta(), finish_reason="stop")]),
    ]
    provider.client.chat.completions.create = AsyncMock(return_value=_FakeStreamCall(chunks))

    req = ChatRequest(messages=[ChatMessage(role="user", content="hi")])
    results = []
    async for chunk in provider.chat_stream(req):
        results.append(chunk)

    assert [c.type for c in results] == ["delta"]
    assert results[0].text == "你好"
