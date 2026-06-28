"""@fileoverview AgentExecutor 单元测试

覆盖 Agent 主循环、工具调用、取消和记忆截断。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse, StreamChunk


class FakeProvider(BaseProvider):
    """模拟 Provider，用于测试。

    responses 是一个列表，每个元素是一个 dict: {"content": str, "tool_calls": list[dict]}。
    chat_stream 按顺序消费 responses，转为 StreamChunk 序列（与 executor 新契约对齐）。
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

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """按顺序消费 responses，转为 StreamChunk 序列。

        每个 response: 若有 tool_calls 则先 yield delta(若有 content) 再 yield tool_calls；
        否则只 yield delta(content)。与真实 Provider 流式行为一致。
        """
        response = self.responses[self.call_index]
        self.call_index += 1
        self.last_messages = req.messages
        self.last_tools = req.tools
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
    """达到最大迭代轮数仍未结束时，返回错误。

    用持续调用工具但不产出 final config 来模拟不终止的多轮（真实场景），
    而非空响应（空响应现在会被空流检测提前终止）。
    """
    registry = ToolRegistry()
    registry.register(
        name="noop_tool",
        description="A no-op tool that never produces final output",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "value": 1},
    )
    # 每轮都调用 noop_tool（有 tool_calls 但无 final_output_tool），不自然终止
    import json

    def _tc(call_id: str, name: str, args: dict) -> dict:
        return {"id": call_id, "function": {"name": name, "arguments": json.dumps(args)}}

    provider = FakeProvider(responses=[{"content": "", "tool_calls": [_tc("c1", "noop_tool", {})]}] * 5)

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is False
    assert "最大迭代" in result.error


@pytest.mark.asyncio
async def test_agent_empty_stream_detected():
    """空流（provider 不返回任何 chunk）被检测为错误，而非误报达到最大迭代。"""
    registry = ToolRegistry()
    # content="" 且无 tool_calls → FakeProvider.chat_stream 不 yield 任何 chunk
    provider = FakeProvider(responses=[{"content": ""}])

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is False
    assert "空响应" in result.error


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
async def test_agent_returns_config_from_generate_config_tool():
    """generate_config 工具成功返回 config 时，Agent 直接结束并返回该 config。"""
    registry = ToolRegistry()
    registry.register(
        name="generate_config",
        description="Generate final config",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "config": {"schemas": {"s1": {}}, "constraints": {"c1": {}}}},
    )

    provider = FakeProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "generate_config", "arguments": "{}"},
                    }
                ],
            },
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is True
    assert result.config == {"schemas": {"s1": {}}, "constraints": {"c1": {}}}
    assert result.iterations == 1
    assert len(result.turns) == 1


@pytest.mark.asyncio
async def test_agent_validates_then_generates_final_config():
    """Agent 可以先调用 validate_config，再调用 generate_config 输出最终配置。"""
    registry = ToolRegistry()
    registry.register(
        name="validate_config",
        description="Validate config",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "issues": []},
    )
    registry.register(
        name="generate_config",
        description="Generate final config",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "config": {"schemas": {"s1": {}}, "constraints": {"c1": {}}}},
    )

    provider = FakeProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "validate_config", "arguments": "{}"},
                    }
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_2",
                        "type": "function",
                        "function": {"name": "generate_config", "arguments": "{}"},
                    }
                ],
            },
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is True
    assert result.config == {"schemas": {"s1": {}}, "constraints": {"c1": {}}}
    assert result.iterations == 2
    assert len(result.turns) == 2


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
