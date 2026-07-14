"""
@fileoverview OllamaProvider 单元测试

测试 tools/tool_choice 传递与 tool_calls 解析。
"""

from unittest.mock import MagicMock, patch

import pytest

from app.shared.services.llm.config.models import ProviderType
from app.shared.services.llm.providers.base import (
    DEFAULT_FALLBACK_CONTEXT_WINDOW,
    ChatMessage,
    ChatRequest,
)
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


def _mock_show_response(model_info: dict, parameters: str | None = None) -> MagicMock:
    """构造一个模拟 urllib urlopen 上下文管理器的对象。

    返回的 MagicMock 支持 with 语句（__enter__ 返回自身），read() 返回 /api/show 的 JSON 字节串。
    """
    import json

    payload: dict = {"model_info": model_info}
    if parameters is not None:
        payload["parameters"] = parameters

    resp = MagicMock()
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    resp.read = MagicMock(return_value=json.dumps(payload).encode("utf-8"))
    return resp


@pytest.fixture
def provider():
    return OllamaProvider(_FakeConfig())


class TestOllamaChatOptions:
    def test_build_chat_options_without_tools(self, provider):
        req = ChatRequest(messages=[ChatMessage(role="user", content="hello")])
        data = provider._build_chat_options(req)
        assert "tools" not in data
        assert "tool_choice" not in data
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][0]["content"] == "hello"

    def test_build_chat_options_with_tools(self, provider):
        tools = [{"type": "function", "function": {"name": "read_table"}}]
        req = ChatRequest(
            messages=[ChatMessage(role="user", content="hello")],
            tools=tools,
            tool_choice="auto",
        )
        data = provider._build_chat_options(req)
        assert data["tools"] == tools
        assert data["tool_choice"] == "auto"

    def test_build_messages_payload_with_tool_fields(self, provider):
        req = ChatRequest(
            messages=[
                ChatMessage(role="assistant", content="", tool_calls=[{"id": "tc1"}]),
                ChatMessage(role="tool", content="result", tool_call_id="tc1"),
            ]
        )
        msgs = provider._build_messages_payload(req)
        assert msgs[0]["tool_calls"] == [{"id": "tc1"}]
        assert msgs[1]["tool_call_id"] == "tc1"

    def test_parse_ollama_tool_calls(self, provider):
        message = {
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "read_table", "arguments": '{"table":"users"}'},
                }
            ]
        }
        tool_calls = provider._parse_ollama_tool_calls(message)
        assert tool_calls is not None
        assert len(tool_calls) == 1
        assert tool_calls[0]["id"] == "call_1"


class TestContextWindow:
    def test_context_window_from_config_override_skips_probe(self):
        # 用户显式指定 context_window 时，不应触发任何探测
        config = _FakeConfig()
        config.context_window = 32000
        provider = OllamaProvider(config)
        assert provider.get_context_window() == 32000
        assert provider._context_window_cache == {}

    def test_context_window_uses_global_fallback_when_probe_unavailable(self):
        # 探测返回 None（服务不可达）时，回退到全局 200k
        provider = OllamaProvider(_FakeConfig())
        assert provider._resolve_context_window("llama3.2") is None
        assert provider.get_context_window() == DEFAULT_FALLBACK_CONTEXT_WINDOW

    def test_resolve_context_window_caches_result(self):
        # 成功探测后结果应缓存，二次调用不再发起请求
        provider = OllamaProvider(_FakeConfig())
        mock_resp = _mock_show_response({"llama.context_length": 131072})

        with patch("urllib.request.urlopen", return_value=mock_resp):
            first = provider._resolve_context_window("llama3.2")
            second = provider._resolve_context_window("llama3.2")

        assert first == 131072
        assert second == 131072
        assert provider._context_window_cache == {"llama3.2": 131072}
        # 第二次命中缓存，urlopen 只应被调用一次
        assert mock_resp.__enter__.call_count == 1

    def test_get_context_window_uses_probed_value(self):
        provider = OllamaProvider(_FakeConfig())
        mock_resp = _mock_show_response({"llama.context_length": 131072})

        with patch("urllib.request.urlopen", return_value=mock_resp):
            assert provider.get_context_window() == 131072

    def test_resolve_context_window_arch_specific_key(self):
        # 不同架构的键名后缀（如 qwen2.context_length）也应被正确提取
        provider = OllamaProvider(_FakeConfig())
        mock_resp = _mock_show_response({"qwen2.context_length": 32768})

        with patch("urllib.request.urlopen", return_value=mock_resp):
            assert provider._resolve_context_window("qwen2.5") == 32768

    def test_resolve_context_window_falls_back_to_num_ctx(self):
        # model_info 缺失 context_length 时，回退到 parameters 中的 num_ctx
        provider = OllamaProvider(_FakeConfig())
        mock_resp = _mock_show_response({}, parameters="num_ctx\t8192\nstop\t<|im_end|>")

        with patch("urllib.request.urlopen", return_value=mock_resp):
            assert provider._resolve_context_window("llama3.2") == 8192

    def test_resolve_context_window_missing_field_returns_none(self):
        # /api/show 响应中既无 context_length 也无 num_ctx 时返回 None
        provider = OllamaProvider(_FakeConfig())
        mock_resp = _mock_show_response({})

        with patch("urllib.request.urlopen", return_value=mock_resp):
            assert provider._resolve_context_window("llama3.2") is None

    def test_extract_context_length_handles_float(self):
        # Ollama 有时返回浮点数，应转为 int
        assert OllamaProvider._extract_context_length({"llama.context_length": 4096.0}) == 4096

    def test_parse_num_ctx_invalid_returns_none(self):
        assert OllamaProvider._parse_num_ctx("num_ctx\tabc") is None
        assert OllamaProvider._parse_num_ctx("") is None
        assert OllamaProvider._parse_num_ctx(None) is None

    def test_parse_ollama_tool_calls_empty(self, provider):
        assert provider._parse_ollama_tool_calls({}) is None
        assert provider._parse_ollama_tool_calls({"tool_calls": []}) is None
