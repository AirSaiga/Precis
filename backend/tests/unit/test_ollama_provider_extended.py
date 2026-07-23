"""OllamaProvider 扩展单元测试

补充 test_ollama_provider.py 未覆盖的路径：
- _post() HTTP 请求与重试逻辑
- chat() 非流式对话
- chat_stream() 流式对话
- list_models() / health() / close()
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from app.shared.services.llm.config.models import ProviderType
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.ollama import OllamaProvider


class _FakeConfig:
    base_url = "http://localhost:11434"
    model = "llama3.2"
    context_window = None
    type = ProviderType.OLLAMA

    def __init__(self):
        self.network = type("Network", (), {"timeout": 60})()

    def model_dump(self, **kwargs):
        return {"base_url": self.base_url, "model": self.model}


@pytest.fixture
def provider():
    return OllamaProvider(_FakeConfig())


def _req(content: str = "hello", **kwargs) -> ChatRequest:
    return ChatRequest(messages=[ChatMessage(role="user", content=content)], **kwargs)


def _mock_post_response(status: int, json_data=None, text: str = ""):
    """构造模拟 aiohttp session.post 响应的上下文管理器。"""
    resp = AsyncMock()
    resp.status = status
    resp.request_info = MagicMock()
    resp.history = ()
    if json_data is not None:
        resp.json = AsyncMock(return_value=json_data)
    resp.text = AsyncMock(return_value=text)

    post_cm = AsyncMock()
    post_cm.__aenter__ = AsyncMock(return_value=resp)
    post_cm.__aexit__ = AsyncMock(return_value=False)
    return post_cm


def _make_mock_session() -> AsyncMock:
    """创建 closed=False 的 mock session，避免 _get_session 误判为已关闭而创建真实 session。"""
    session = AsyncMock()
    session.closed = False
    return session


class TestOllamaPost:
    @pytest.mark.asyncio
    async def test_post_success(self, provider):
        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=_mock_post_response(200, {"result": "ok"}))
        provider._session = mock_session

        result = await provider._post("chat", {"model": "llama3.2"})
        assert result == {"result": "ok"}

    @pytest.mark.asyncio
    async def test_post_500_retries_then_raises(self, provider):
        mock_resp = AsyncMock()
        mock_resp.status = 500
        mock_resp.request_info = MagicMock()
        mock_resp.history = ()

        post_cm = AsyncMock()
        post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        post_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=post_cm)
        provider._session = mock_session

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(aiohttp.ClientResponseError):
                await provider._post("chat", {})

        assert mock_session.post.call_count == 3

    @pytest.mark.asyncio
    async def test_post_429_retries(self, provider):
        mock_resp = AsyncMock()
        mock_resp.status = 429
        mock_resp.request_info = MagicMock()
        mock_resp.history = ()

        post_cm = AsyncMock()
        post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        post_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=post_cm)
        provider._session = mock_session

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(aiohttp.ClientResponseError):
                await provider._post("chat", {})

        assert mock_session.post.call_count == 3

    @pytest.mark.asyncio
    async def test_post_400_raises_immediately(self, provider):
        mock_resp = AsyncMock()
        mock_resp.status = 400
        mock_resp.request_info = MagicMock()
        mock_resp.history = ()
        mock_resp.text = AsyncMock(return_value="Bad Request")

        post_cm = AsyncMock()
        post_cm.__aenter__ = AsyncMock(return_value=mock_resp)
        post_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=post_cm)
        provider._session = mock_session

        with pytest.raises(aiohttp.ClientResponseError):
            await provider._post("chat", {})

        # 400 不可重试，只调用一次
        assert mock_session.post.call_count == 1

    @pytest.mark.asyncio
    async def test_post_non_dict_json_raises_value_error(self, provider):
        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=_mock_post_response(200, ["not", "a", "dict"]))
        provider._session = mock_session

        with pytest.raises(ValueError, match="非 JSON 对象"):
            await provider._post("chat", {})

    @pytest.mark.asyncio
    async def test_post_connection_error_retries(self, provider):
        mock_session = _make_mock_session()
        mock_session.post = MagicMock(side_effect=aiohttp.ClientConnectionError("refused"))
        provider._session = mock_session

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(aiohttp.ClientConnectionError):
                await provider._post("chat", {})

        assert mock_session.post.call_count == 3


class TestOllamaChat:
    @pytest.mark.asyncio
    async def test_chat_success(self, provider):
        resp_data = {
            "message": {"content": "Hello!", "role": "assistant"},
            "model": "llama3.2",
        }
        with patch.object(provider, "_post", new_callable=AsyncMock, return_value=resp_data):
            result = await provider.chat(_req())

        assert result.content == "Hello!"
        assert result.model == "llama3.2"
        assert result.tool_calls is None

    @pytest.mark.asyncio
    async def test_chat_with_tool_calls(self, provider):
        resp_data = {
            "message": {
                "content": "",
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "read_table", "arguments": '{"table":"users"}'},
                    }
                ],
            },
            "model": "llama3.2",
        }
        with patch.object(provider, "_post", new_callable=AsyncMock, return_value=resp_data):
            result = await provider.chat(_req())

        assert result.tool_calls is not None
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0]["function"]["name"] == "read_table"

    @pytest.mark.asyncio
    async def test_chat_missing_message_key_raises_value_error(self, provider):
        with patch.object(provider, "_post", new_callable=AsyncMock, return_value={"error": "no message"}):
            with pytest.raises(ValueError, match="解析 Ollama 响应失败"):
                await provider.chat(_req())

    @pytest.mark.asyncio
    async def test_chat_uses_config_model_when_resp_missing_model(self, provider):
        resp_data = {"message": {"content": "ok", "role": "assistant"}}
        with patch.object(provider, "_post", new_callable=AsyncMock, return_value=resp_data):
            result = await provider.chat(_req())

        assert result.model == "llama3.2"

    @pytest.mark.asyncio
    async def test_chat_stream_false_in_payload(self, provider):
        resp_data = {"message": {"content": "ok"}, "model": "llama3.2"}
        mock_post = AsyncMock(return_value=resp_data)
        with patch.object(provider, "_post", mock_post):
            await provider.chat(_req())

        call_args = mock_post.call_args
        assert call_args[0][1]["stream"] is False


class TestOllamaChatStream:
    def _make_stream_session(self, lines: list[bytes], status: int = 200):
        """构造模拟流式响应的 session。"""
        resp = AsyncMock()
        resp.status = status
        resp.request_info = MagicMock()
        resp.history = ()
        resp.text = AsyncMock(return_value="")

        async def content_iter():
            for line in lines:
                yield line

        resp.content = content_iter()

        post_cm = AsyncMock()
        post_cm.__aenter__ = AsyncMock(return_value=resp)
        post_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=post_cm)
        return mock_session

    @pytest.mark.asyncio
    async def test_stream_text_deltas(self, provider):
        lines = [
            json.dumps({"message": {"content": "Hello"}}).encode() + b"\n",
            json.dumps({"message": {"content": " World"}}).encode() + b"\n",
        ]
        provider._session = self._make_stream_session(lines)

        chunks = [c async for c in provider.chat_stream(_req())]
        assert len(chunks) == 2
        assert chunks[0].type == "delta"
        assert chunks[0].text == "Hello"
        assert chunks[1].text == " World"

    @pytest.mark.asyncio
    async def test_stream_tool_calls(self, provider):
        lines = [
            json.dumps(
                {
                    "message": {
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "read_table", "arguments": "{}"},
                            }
                        ],
                    }
                }
            ).encode()
            + b"\n",
        ]
        provider._session = self._make_stream_session(lines)

        chunks = [c async for c in provider.chat_stream(_req())]
        assert len(chunks) == 1
        assert chunks[0].type == "tool_calls"
        assert chunks[0].tool_calls[0]["function"]["name"] == "read_table"

    @pytest.mark.asyncio
    async def test_stream_error_chunk_raises_value_error(self, provider):
        lines = [json.dumps({"error": "model not found"}).encode() + b"\n"]
        provider._session = self._make_stream_session(lines)

        with pytest.raises(ValueError, match="Ollama 流式错误"):
            [c async for c in provider.chat_stream(_req())]

    @pytest.mark.asyncio
    async def test_stream_skips_invalid_json_lines(self, provider):
        lines = [
            b"not valid json\n",
            json.dumps({"message": {"content": "ok"}}).encode() + b"\n",
        ]
        provider._session = self._make_stream_session(lines)

        chunks = [c async for c in provider.chat_stream(_req())]
        assert len(chunks) == 1
        assert chunks[0].text == "ok"

    @pytest.mark.asyncio
    async def test_stream_skips_chunks_without_message(self, provider):
        lines = [
            json.dumps({"done": False}).encode() + b"\n",
            json.dumps({"message": {"content": "ok"}}).encode() + b"\n",
        ]
        provider._session = self._make_stream_session(lines)

        chunks = [c async for c in provider.chat_stream(_req())]
        assert len(chunks) == 1

    @pytest.mark.asyncio
    async def test_stream_http_error_raises(self, provider):
        resp = AsyncMock()
        resp.status = 404
        resp.request_info = MagicMock()
        resp.history = ()
        resp.text = AsyncMock(return_value="Not Found")

        post_cm = AsyncMock()
        post_cm.__aenter__ = AsyncMock(return_value=resp)
        post_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=post_cm)
        provider._session = mock_session

        with pytest.raises(aiohttp.ClientResponseError):
            [c async for c in provider.chat_stream(_req())]

    @pytest.mark.asyncio
    async def test_stream_no_retry_after_yield(self, provider):
        """已 yield 后发生连接错误，不重试直接抛出。"""
        resp = AsyncMock()
        resp.status = 200
        resp.request_info = MagicMock()
        resp.history = ()

        call_count = [0]

        async def content_iter():
            call_count[0] += 1
            yield json.dumps({"message": {"content": "partial"}}).encode() + b"\n"
            raise aiohttp.ClientConnectionError("connection lost")

        resp.content = content_iter()

        post_cm = AsyncMock()
        post_cm.__aenter__ = AsyncMock(return_value=resp)
        post_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.post = MagicMock(return_value=post_cm)
        provider._session = mock_session

        with pytest.raises(aiohttp.ClientConnectionError):
            [c async for c in provider.chat_stream(_req())]

        # 已 yield 后不重试
        assert call_count[0] == 1

    @pytest.mark.asyncio
    async def test_stream_retries_before_yield_on_connection_error(self, provider):
        """未 yield 前发生连接错误，触发重试。"""
        mock_session = _make_mock_session()
        mock_session.post = MagicMock(side_effect=aiohttp.ClientConnectionError("refused"))
        provider._session = mock_session

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(aiohttp.ClientConnectionError):
                [c async for c in provider.chat_stream(_req())]

        assert mock_session.post.call_count == 3


class TestOllamaListModels:
    @pytest.mark.asyncio
    async def test_list_models_success(self, provider):
        json_data = {"models": [{"name": "llama3.2"}, {"name": "qwen2.5"}]}

        resp = AsyncMock()
        resp.json = AsyncMock(return_value=json_data)

        get_cm = AsyncMock()
        get_cm.__aenter__ = AsyncMock(return_value=resp)
        get_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.get = MagicMock(return_value=get_cm)
        provider._session = mock_session

        result = await provider.list_models()
        assert result == ["llama3.2", "qwen2.5"]

    @pytest.mark.asyncio
    async def test_list_models_empty(self, provider):
        resp = AsyncMock()
        resp.json = AsyncMock(return_value={"models": []})

        get_cm = AsyncMock()
        get_cm.__aenter__ = AsyncMock(return_value=resp)
        get_cm.__aexit__ = AsyncMock(return_value=False)

        mock_session = _make_mock_session()
        mock_session.get = MagicMock(return_value=get_cm)
        provider._session = mock_session

        result = await provider.list_models()
        assert result == []


class TestOllamaHealth:
    @pytest.mark.asyncio
    async def test_health_ok(self, provider):
        with patch.object(provider, "list_models", new_callable=AsyncMock, return_value=["llama3.2"]):
            result = await provider.health()

        assert result["status"] == "ok"
        assert "latency_ms" in result

    @pytest.mark.asyncio
    async def test_health_error(self, provider):
        with patch.object(provider, "list_models", new_callable=AsyncMock, side_effect=Exception("Connection refused")):
            result = await provider.health()

        assert result["status"] == "error"
        assert "Connection refused" in result["error"]


class TestOllamaSession:
    @pytest.mark.asyncio
    async def test_close_session(self, provider):
        mock_session = _make_mock_session()
        provider._session = mock_session

        await provider.close()

        mock_session.close.assert_called_once()
        assert provider._session is None

    @pytest.mark.asyncio
    async def test_close_no_session(self, provider):
        provider._session = None
        await provider.close()  # 不应抛出异常

    @pytest.mark.asyncio
    async def test_close_already_closed_session(self, provider):
        mock_session = AsyncMock()
        mock_session.closed = True
        provider._session = mock_session

        await provider.close()
        mock_session.close.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_session_creates_new_when_none(self, provider):
        provider._session = None
        mock_new_session = _make_mock_session()
        with patch("aiohttp.ClientSession", return_value=mock_new_session):
            session = await provider._get_session()
        assert session is mock_new_session
        assert provider._session is mock_new_session

    @pytest.mark.asyncio
    async def test_get_session_recreates_when_closed(self, provider):
        mock_session = AsyncMock()
        mock_session.closed = True
        provider._session = mock_session

        mock_new_session = _make_mock_session()
        with patch("aiohttp.ClientSession", return_value=mock_new_session):
            new_session = await provider._get_session()
        assert new_session is mock_new_session
