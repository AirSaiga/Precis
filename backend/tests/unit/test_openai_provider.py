"""OpenAIProvider 单元测试

测试 OpenAI 兼容 Provider 的核心功能：
- chat() 非流式对话（成功/tool_calls/重试/错误处理）
- chat_stream() 流式对话（文本/tool_calls/重试安全门）
- list_models() / health()
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.llm.config.models import AIProvider, NetworkConfig, ProviderType
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.openai import OpenAIProvider


def _make_config(**kwargs) -> AIProvider:
    defaults = {
        "id": "test-openai",
        "name": "Test OpenAI",
        "type": ProviderType.OPENAI,
        "base_url": "http://localhost:8000/v1",
        "api_key": "test-key",
        "model": "gpt-4",
    }
    defaults.update(kwargs)
    return AIProvider(**defaults)


@pytest.fixture
def provider():
    return OpenAIProvider(_make_config())


def _req(content: str = "hello", **kwargs) -> ChatRequest:
    return ChatRequest(messages=[ChatMessage(role="user", content=content)], **kwargs)


class TestOpenAIProviderInit:
    def test_name_property(self, provider):
        assert provider.name == "OpenAI-Compatible"

    def test_init_without_network_config(self):
        p = OpenAIProvider(_make_config(network=None))
        assert p.client is not None

    def test_init_with_network_config(self):
        p = OpenAIProvider(_make_config(network=NetworkConfig(timeout=30)))
        assert p.client is not None


class TestOpenAIChat:
    @pytest.mark.asyncio
    async def test_chat_success(self, provider):
        mock_message = MagicMock()
        mock_message.content = "Hello!"
        mock_message.tool_calls = None

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]
        mock_resp.model = "gpt-4"

        provider.client.chat.completions.create = AsyncMock(return_value=mock_resp)
        result = await provider.chat(_req())

        assert result.content == "Hello!"
        assert result.model == "gpt-4"
        assert result.tool_calls is None

    @pytest.mark.asyncio
    async def test_chat_with_tool_calls(self, provider):
        mock_tc = MagicMock()
        mock_tc.id = "call_1"
        mock_tc.type = "function"
        mock_tc.function.name = "read_table"
        mock_tc.function.arguments = '{"table":"users"}'

        mock_message = MagicMock()
        mock_message.content = ""
        mock_message.tool_calls = [mock_tc]

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]
        mock_resp.model = "gpt-4"

        provider.client.chat.completions.create = AsyncMock(return_value=mock_resp)
        result = await provider.chat(_req())

        assert result.tool_calls is not None
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0]["id"] == "call_1"
        assert result.tool_calls[0]["function"]["name"] == "read_table"

    @pytest.mark.asyncio
    async def test_chat_empty_choices_raises_value_error(self, provider):
        mock_resp = MagicMock()
        mock_resp.choices = []

        provider.client.chat.completions.create = AsyncMock(return_value=mock_resp)

        with pytest.raises(ValueError, match="空的 choices"):
            await provider.chat(_req())

    @pytest.mark.asyncio
    async def test_chat_with_tools_in_request(self, provider):
        mock_message = MagicMock()
        mock_message.content = "result"
        mock_message.tool_calls = None

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]
        mock_resp.model = "gpt-4"

        provider.client.chat.completions.create = AsyncMock(return_value=mock_resp)
        tools = [{"type": "function", "function": {"name": "test"}}]
        await provider.chat(_req(tools=tools, tool_choice="auto"))

        call_kwargs = provider.client.chat.completions.create.call_args[1]
        assert call_kwargs["tools"] == tools
        assert call_kwargs["tool_choice"] == "auto"

    @pytest.mark.asyncio
    async def test_chat_messages_payload_includes_tool_fields(self, provider):
        mock_message = MagicMock()
        mock_message.content = "ok"
        mock_message.tool_calls = None

        mock_choice = MagicMock()
        mock_choice.message = mock_message

        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]
        mock_resp.model = "gpt-4"

        provider.client.chat.completions.create = AsyncMock(return_value=mock_resp)

        req = ChatRequest(
            messages=[
                ChatMessage(role="assistant", content="", tool_calls=[{"id": "tc1"}]),
                ChatMessage(role="tool", content="result", tool_call_id="tc1"),
            ]
        )
        await provider.chat(req)

        call_kwargs = provider.client.chat.completions.create.call_args[1]
        msgs = call_kwargs["messages"]
        assert msgs[0]["tool_calls"] == [{"id": "tc1"}]
        assert msgs[1]["tool_call_id"] == "tc1"

    @pytest.mark.asyncio
    async def test_chat_non_retryable_status_raises_immediately(self, provider):
        from openai import APIStatusError

        mock_request = MagicMock()
        mock_request.method = "POST"
        mock_request.url = "http://test"
        mock_request.headers = {}

        error = APIStatusError(
            message="Not Found",
            response=MagicMock(status_code=404, headers={}),
            body=None,
        )
        provider.client.chat.completions.create = AsyncMock(side_effect=error)

        with pytest.raises(APIStatusError):
            await provider.chat(_req())

        # 404 不可重试，只调用一次
        assert provider.client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_chat_retries_on_429_then_succeeds(self, provider):
        from openai import APIStatusError

        mock_message = MagicMock()
        mock_message.content = "ok"
        mock_message.tool_calls = None
        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]
        mock_resp.model = "gpt-4"

        error = APIStatusError(
            message="Rate limited",
            response=MagicMock(status_code=429, headers={}),
            body=None,
        )
        provider.client.chat.completions.create = AsyncMock(side_effect=[error, mock_resp])

        with patch("asyncio.sleep", new_callable=AsyncMock):
            result = await provider.chat(_req())

        assert result.content == "ok"
        assert provider.client.chat.completions.create.call_count == 2

    @pytest.mark.asyncio
    async def test_chat_retries_exhausted_raises(self, provider):
        from openai import APIStatusError

        error = APIStatusError(
            message="Server Error",
            response=MagicMock(status_code=500, headers={}),
            body=None,
        )
        provider.client.chat.completions.create = AsyncMock(side_effect=error)

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(APIStatusError):
                await provider.chat(_req())

        assert provider.client.chat.completions.create.call_count == 3

    @pytest.mark.asyncio
    async def test_chat_parse_error_raises_value_error(self, provider):
        # choices[0].message 为 None 时触发 AttributeError → ValueError
        mock_choice = MagicMock()
        mock_choice.message = None

        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]

        provider.client.chat.completions.create = AsyncMock(return_value=mock_resp)

        with pytest.raises(ValueError, match="解析 API 响应失败"):
            await provider.chat(_req())


class TestOpenAIChatStream:
    @pytest.mark.asyncio
    async def test_stream_text_deltas(self, provider):
        delta1 = MagicMock()
        delta1.content = "Hello"
        delta1.tool_calls = None
        choice1 = MagicMock()
        choice1.delta = delta1
        choice1.finish_reason = None

        delta2 = MagicMock()
        delta2.content = " World"
        delta2.tool_calls = None
        choice2 = MagicMock()
        choice2.delta = delta2
        choice2.finish_reason = "stop"

        chunk1 = MagicMock()
        chunk1.choices = [choice1]
        chunk2 = MagicMock()
        chunk2.choices = [choice2]

        async def mock_stream():
            yield chunk1
            yield chunk2

        provider.client.chat.completions.create = AsyncMock(return_value=mock_stream())
        chunks = [c async for c in provider.chat_stream(_req())]

        assert len(chunks) == 2
        assert chunks[0].type == "delta"
        assert chunks[0].text == "Hello"
        assert chunks[1].text == " World"

    @pytest.mark.asyncio
    async def test_stream_tool_calls(self, provider):
        # 构造 tool_calls 分片
        tc_delta = MagicMock()
        tc_delta.index = 0
        tc_delta.id = "call_1"
        tc_delta.function.name = "read_table"
        tc_delta.function.arguments = '{"table":"users"}'

        delta1 = MagicMock()
        delta1.content = None
        delta1.tool_calls = [tc_delta]
        choice1 = MagicMock()
        choice1.delta = delta1
        choice1.finish_reason = None

        delta2 = MagicMock()
        delta2.content = None
        delta2.tool_calls = None
        choice2 = MagicMock()
        choice2.delta = delta2
        choice2.finish_reason = "tool_calls"

        chunk1 = MagicMock()
        chunk1.choices = [choice1]
        chunk2 = MagicMock()
        chunk2.choices = [choice2]

        async def mock_stream():
            yield chunk1
            yield chunk2

        provider.client.chat.completions.create = AsyncMock(return_value=mock_stream())
        chunks = [c async for c in provider.chat_stream(_req())]

        assert len(chunks) == 1
        assert chunks[0].type == "tool_calls"
        assert chunks[0].tool_calls[0]["id"] == "call_1"
        assert chunks[0].tool_calls[0]["function"]["name"] == "read_table"

    @pytest.mark.asyncio
    async def test_stream_skips_empty_choices(self, provider):
        empty_chunk = MagicMock()
        empty_chunk.choices = []

        delta = MagicMock()
        delta.content = "ok"
        delta.tool_calls = None
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = "stop"
        good_chunk = MagicMock()
        good_chunk.choices = [choice]

        async def mock_stream():
            yield empty_chunk
            yield good_chunk

        provider.client.chat.completions.create = AsyncMock(return_value=mock_stream())
        chunks = [c async for c in provider.chat_stream(_req())]

        assert len(chunks) == 1
        assert chunks[0].text == "ok"

    @pytest.mark.asyncio
    async def test_stream_retries_before_yield(self, provider):
        from openai import APIConnectionError

        error = APIConnectionError(request=MagicMock())

        delta = MagicMock()
        delta.content = "ok"
        delta.tool_calls = None
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = "stop"
        chunk = MagicMock()
        chunk.choices = [choice]

        async def mock_stream():
            yield chunk

        provider.client.chat.completions.create = AsyncMock(side_effect=[error, mock_stream()])

        with patch("asyncio.sleep", new_callable=AsyncMock):
            chunks = [c async for c in provider.chat_stream(_req())]

        assert len(chunks) == 1
        assert chunks[0].text == "ok"

    @pytest.mark.asyncio
    async def test_stream_no_retry_after_yield(self, provider):
        from openai import APIConnectionError

        delta = MagicMock()
        delta.content = "partial"
        delta.tool_calls = None
        choice = MagicMock()
        choice.delta = delta
        choice.finish_reason = None
        chunk = MagicMock()
        chunk.choices = [choice]

        call_count = [0]

        async def mock_stream(**kwargs):
            call_count[0] += 1
            yield chunk
            raise APIConnectionError(request=MagicMock())

        provider.client.chat.completions.create = AsyncMock(side_effect=mock_stream)

        with pytest.raises(APIConnectionError):
            [c async for c in provider.chat_stream(_req())]

        # 已 yield 后不重试，只调用一次
        assert call_count[0] == 1

    @pytest.mark.asyncio
    async def test_stream_non_retryable_status_raises(self, provider):
        from openai import APIStatusError

        error = APIStatusError(
            message="Unauthorized",
            response=MagicMock(status_code=401, headers={}),
            body=None,
        )
        provider.client.chat.completions.create = AsyncMock(side_effect=error)

        with pytest.raises(APIStatusError):
            [c async for c in provider.chat_stream(_req())]

        assert provider.client.chat.completions.create.call_count == 1

    @pytest.mark.asyncio
    async def test_stream_with_tools_in_request(self, provider):
        async def mock_stream():
            return
            yield  # pragma: no cover

        provider.client.chat.completions.create = AsyncMock(return_value=mock_stream())
        tools = [{"type": "function", "function": {"name": "test"}}]
        [c async for c in provider.chat_stream(_req(tools=tools))]

        call_kwargs = provider.client.chat.completions.create.call_args[1]
        assert call_kwargs["tools"] == tools
        assert call_kwargs["stream"] is True


class TestOpenAIListModels:
    @pytest.mark.asyncio
    async def test_list_models_success(self, provider):
        model1 = MagicMock()
        model1.id = "gpt-4"
        model2 = MagicMock()
        model2.id = "gpt-3.5-turbo"

        mock_models = MagicMock()
        mock_models.data = [model1, model2]

        provider.client.models.list = AsyncMock(return_value=mock_models)
        result = await provider.list_models()

        assert result == ["gpt-4", "gpt-3.5-turbo"]


class TestOpenAIHealth:
    @pytest.mark.asyncio
    async def test_health_ok(self, provider):
        mock_models = MagicMock()
        mock_models.data = []
        provider.client.models.list = AsyncMock(return_value=mock_models)

        result = await provider.health()
        assert result["status"] == "ok"
        assert "latency_ms" in result

    @pytest.mark.asyncio
    async def test_health_error(self, provider):
        provider.client.models.list = AsyncMock(side_effect=Exception("Connection failed"))

        result = await provider.health()
        assert result["status"] == "error"
        assert "Connection failed" in result["error"]
