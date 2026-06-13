"""@fileoverview AgentExecutor 单元测试

覆盖 Agent 主循环、工具调用、取消和记忆截断。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse


class FakeProvider(BaseProvider):
    """模拟 Provider，用于测试"""

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
        self.last_tools = None

    @property
    def name(self):
        return "Fake"

    async def chat(self, req: ChatRequest) -> ChatResponse:
        response = self.responses[self.call_index]
        self.call_index += 1
        self.last_messages = req.messages
        self.last_tools = req.tools
        return ChatResponse(
            content=response.get("content"),
            tool_calls=response.get("tool_calls"),
            model="fake",
        )

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[str]:
        yield ""

    async def list_models(self) -> list[str]:
        return ["fake"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}

    @property
    def model(self) -> str:
        return self.cfg.model


@pytest.mark.asyncio
async def test_agent_runs_tool_and_continues():
    """Agent 调用工具后，把结果回传并继续下一轮。"""
    registry = ToolRegistry()
    registry.register(
        name="test_tool",
        description="A test tool",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "value": 42},
    )

    provider = FakeProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "test_tool", "arguments": "{}"},
                    }
                ],
            },
            {"content": "Done"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is True
    assert result.content == "Done"
    assert len(result.turns) == 2
    assert result.turns[0].tool_calls[0].name == "test_tool"


@pytest.mark.asyncio
async def test_agent_returns_direct_content():
    """Agent 直接返回文本时，不调用工具也结束。"""
    registry = ToolRegistry()
    provider = FakeProvider(responses=[{"content": "Final answer"}])

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is True
    assert result.content == "Final answer"
    assert len(result.turns) == 1


@pytest.mark.asyncio
async def test_agent_respects_max_iterations():
    """达到最大迭代轮数仍未结束时，返回错误。"""
    registry = ToolRegistry()
    provider = FakeProvider(responses=[{"content": ""}] * 5)

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is False
    assert "最大迭代" in result.error


@pytest.mark.asyncio
async def test_agent_cancelled():
    """取消回调返回 True 时立即退出。"""
    registry = ToolRegistry()
    provider = FakeProvider(responses=[{"content": "never"}])

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        max_iterations=3,
        cancelled_callback=lambda: True,
    )
    result = await executor.run("test task")

    assert result.success is False
    assert "取消" in result.error


@pytest.mark.asyncio
async def test_agent_tool_failure():
    """工具执行失败时，结果中携带错误信息。"""
    registry = ToolRegistry()
    registry.register(
        name="bad_tool",
        description="Bad tool",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: (_ for _ in ()).throw(ValueError("boom")),
    )

    provider = FakeProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "bad_tool", "arguments": "{}"},
                    }
                ],
            },
            {"content": "Recovered"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is True
    assert result.content == "Recovered"
    assert result.turns[0].tool_results[0].success is False
