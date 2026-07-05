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
    # 失败原因必须回灌给 LLM（否则 LLM 看到空 tool 回复无法自我修正）
    assert result.turns[0].tool_results[0].error == "工具执行异常: boom"
    # 第二轮请求的 messages 里应含一条 tool 消息，且 content 包含 [ERROR] 前缀和原异常信息
    tool_msgs = [m for m in (provider.last_messages or []) if m.role == "tool"]
    assert tool_msgs, "失败工具的 observation 应作为 tool 消息回灌给 LLM"
    assert "[ERROR]" in (tool_msgs[-1].content or "")
    assert "boom" in (tool_msgs[-1].content or "")


@pytest.mark.asyncio
async def test_unknown_tool_error_visible_to_llm():
    """LLM 调用了未注册的工具 → '未知工具' 错误也必须回灌给 LLM。"""
    registry = ToolRegistry()  # 空注册表，任何工具名都算未知

    provider = FakeProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_x",
                        "type": "function",
                        "function": {"name": "ghost_tool", "arguments": "{}"},
                    }
                ],
            },
            {"content": "给用户一个友好的回复"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("test task")

    assert result.success is True
    # 未知工具错误进 messages，LLM 第二轮能看到失败原因
    tool_msgs = [m for m in (provider.last_messages or []) if m.role == "tool"]
    assert tool_msgs
    assert "未知工具" in (tool_msgs[-1].content or "")
    assert "ghost_tool" in (tool_msgs[-1].content or "")


@pytest.mark.asyncio
async def test_business_error_in_dict_reaches_llm():
    """工具返回 {"success": False, "error": "..."} 形式的业务错误时，error 字段应回灌给 LLM。

    模拟 apply_actions 预验证失败的返回形态：工具执行本身没抛异常，但业务逻辑
    判定失败并返回结构化错误（如"列不存在，did you mean xxx"）。这类错误此前同样
    被 executor 的 observation="" 逻辑吞掉，did-you-mean 建议无法传达 LLM。
    """
    registry = ToolRegistry()
    # 模拟 apply_actions 预验证失败的 handler：返回 dict 形式的业务错误
    registry.register(
        name="apply_actions",
        description="模拟 apply_actions",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {
            "success": False,
            "error": "列 'emial' 不存在，did you mean: email",
            "results": [],
        },
    )

    provider = FakeProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "apply_actions", "arguments": "{}"},
                    }
                ],
            },
            {"content": "已为你修正为 email 列"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    result = await executor.run("为 emial 加非空约束")

    assert result.success is True
    # 业务错误（含 did-you-mean 建议）必须能被下一轮 LLM 看到，驱动自我修正
    tool_msgs = [m for m in (provider.last_messages or []) if m.role == "tool"]
    assert tool_msgs
    content = tool_msgs[-1].content or ""
    assert "[ERROR]" in content
    assert "did you mean" in content
    assert "email" in content


# =============================================================================
# P1-2 循环收敛引导测试
# =============================================================================


class _RecordingProvider(FakeProvider):
    """记录每次 chat_stream 调用时的 messages，用于验证 reminder 注入时机。"""

    def __init__(self, responses):
        super().__init__(responses)
        self.all_messages: list[list] = []

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        # 记录本轮 LLM 收到的 messages 快照
        self.all_messages.append(list(req.messages))
        async for chunk in super().chat_stream(req):
            yield chunk


@pytest.mark.asyncio
async def test_convergence_reminder_injected_at_last_turn():
    """达到 max_iterations 时注入收敛 reminder，提示 LLM 不再调工具。

    构造 max_iterations=2，LLM 两轮都调工具（不收敛）。第 2 轮（最后一轮）的
    请求 messages 中应含收敛 reminder。
    """
    registry = ToolRegistry()
    registry.register(
        name="noop",
        description="Noop",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True},
    )

    provider = _RecordingProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "noop", "arguments": "{}"}}],
            },
            {
                "content": "",
                "tool_calls": [{"id": "c2", "type": "function", "function": {"name": "noop", "arguments": "{}"}}],
            },
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=2)
    await executor.run("test")

    # 至少调用了 2 轮（第 2 轮是最后一轮）
    assert len(provider.all_messages) >= 2
    last_turn_messages = provider.all_messages[-1]
    # 最后一轮的 messages 中应含收敛 reminder（在最后一条 user 消息里）
    reminder_texts = [
        (m.content or "") for m in last_turn_messages if m.role == "user" and "工具调用预算" in (m.content or "")
    ]
    assert reminder_texts, "最后一轮应注入收敛 reminder，提示 LLM 不再调工具"


@pytest.mark.asyncio
async def test_repeated_tool_call_triggers_warning():
    """连续两轮调用同一工具同一参数 → 第二轮请求前注入重复调用 warning。

    第 1 轮记录签名，第 1 轮 tool_calls 确定后注入 warning（供第 2 轮 LLM 看到）。
    所以第 2 轮的请求 messages 中应含 warning。
    """
    registry = ToolRegistry()
    registry.register(
        name="query",
        description="Query",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "data": "ok"},
    )

    provider = _RecordingProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "query", "arguments": '{"q":"x"}'}}
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {"id": "c2", "type": "function", "function": {"name": "query", "arguments": '{"q":"x"}'}}
                ],
            },
            {"content": "完成"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    await executor.run("test")

    # 第 1 轮记录签名（_prev_tool_signatures 初始为空，不命中）；
    # 第 2 轮 tool_calls 确定后命中重复 → 注入 warning，供第 3 轮 LLM 看到。
    assert len(provider.all_messages) >= 3, "重复检测需至少 3 轮才能验证 warning 可见性"
    third_turn_messages = provider.all_messages[2]
    warning_texts = [
        (m.content or "") for m in third_turn_messages if m.role == "user" and "已经调用过" in (m.content or "")
    ]
    assert warning_texts, "第三轮应看到上一轮注入的重复调用 warning"
    # warning 应提到重复的工具名
    assert "query" in warning_texts[0]


@pytest.mark.asyncio
async def test_different_args_no_false_warning():
    """连续两轮调同一工具但参数不同 → 不触发重复调用 warning。"""
    registry = ToolRegistry()
    registry.register(
        name="query",
        description="Query",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True, "data": "ok"},
    )

    provider = _RecordingProvider(
        responses=[
            {
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "query", "arguments": '{"q":"a"}'}}
                ],
            },
            {
                "content": "",
                "tool_calls": [
                    {"id": "c2", "type": "function", "function": {"name": "query", "arguments": '{"q":"b"}'}}
                ],
            },
            {"content": "完成"},
        ]
    )

    executor = AgentExecutor(provider=provider, registry=registry, max_iterations=3)
    await executor.run("test")

    # 第 2 轮参数不同 → 签名不同 → 不命中 → 第 3 轮 messages 不含重复 warning
    assert len(provider.all_messages) >= 3
    third_turn_messages = provider.all_messages[2]
    warning_texts = [
        (m.content or "") for m in third_turn_messages if m.role == "user" and "已经调用过" in (m.content or "")
    ]
    assert not warning_texts, "不同参数的调用不应触发重复 warning"
