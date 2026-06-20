"""
@fileoverview OllamaProvider 单元测试

测试 tools/tool_choice 传递与 tool_calls 解析。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.ollama import OllamaProvider


class _FakeConfig:
    base_url = "http://localhost:11434"
    model = "llama3.2"

    def __init__(self):
        self.network = type("Network", (), {"timeout": 60})()

    def model_dump(self, **kwargs):
        return {"base_url": self.base_url, "model": self.model}


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
        assert tool_calls[0]["function"]["name"] == "read_table"

    def test_parse_ollama_tool_calls_empty(self, provider):
        assert provider._parse_ollama_tool_calls({}) is None
        assert provider._parse_ollama_tool_calls({"tool_calls": []}) is None
