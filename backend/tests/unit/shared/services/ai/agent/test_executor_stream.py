"""@fileoverview AgentExecutor 流式化专项测试

验证流式契约(chat_stream)、回调注入(on_chunk/on_turn/on_tool_call)、取消检查点(cancelled)。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.ai.agent.types import AgentResult
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse, StreamChunk


class _StreamFakeProvider(BaseProvider):
    """模拟 Provider，按预设 StreamChunk 序列返回（按轮次消费）。

    responses 是 list[list[StreamChunk]]，每个内层 list 是一轮的 chunk 序列。
    """

    def __init__(self, responses: list[list[StreamChunk]]):
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

    @property
    def name(self):
        return "Fake"

    @property
    def model(self) -> str:
        return self.cfg.model

    async def chat(self, req: ChatRequest) -> ChatResponse:  # pragma: no cover - 流式化后不再使用
        return ChatResponse(content="", model="fake")

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        for chunk in self.responses[self.call_index]:
            yield chunk
        self.call_index += 1

    async def list_models(self) -> list[str]:
        return ["fake"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}


def test_agent_result_cancelled_default():
    """AgentResult 默认 cancelled=False。"""
    r = AgentResult(success=True)
    assert r.cancelled is False
    assert r.to_dict()["cancelled"] is False


def test_agent_result_cancelled_true():
    """AgentResult 可设置 cancelled=True。"""
    r = AgentResult(success=False, cancelled=True, error="任务已取消")
    assert r.cancelled is True
    assert r.to_dict()["cancelled"] is True


@pytest.mark.asyncio
async def test_executor_streams_delta_and_terminates_on_text():
    """流式文本: delta 回调被触发，无 tool_calls → 终止。"""
    provider = _StreamFakeProvider(
        responses=[[StreamChunk(type="delta", text="你好"), StreamChunk(type="delta", text="世界")]]
    )
    registry = ToolRegistry()
    chunks_received: list[str] = []
    turns_received: list[int] = []

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        on_chunk=lambda t: chunks_received.append(t),
        on_turn=lambda n: turns_received.append(n),
    )

    result = await executor.run("测试任务")

    assert "".join(chunks_received) == "你好世界"
    assert turns_received == [1]
    assert result.success is True
    assert result.content == "你好世界"


@pytest.mark.asyncio
async def test_executor_tool_calls_continue_loop():
    """有 tool_calls 的轮 → 执行工具后继续循环 → 下一轮纯文本终止。"""
    provider = _StreamFakeProvider(
        responses=[
            [
                StreamChunk(
                    type="tool_calls", tool_calls=[{"id": "c1", "function": {"name": "noop", "arguments": "{}"}}]
                )
            ],
            [StreamChunk(type="delta", text="完成")],
        ]
    )
    registry = ToolRegistry()
    registry.register("noop", "测试工具", {"type": "object", "properties": {}}, lambda args: {"success": True})

    tool_calls_received: list[tuple[str, str, int]] = []
    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        on_tool_call=lambda name, cid, turn: tool_calls_received.append((name, cid, turn)),
    )

    result = await executor.run("测试任务")

    assert result.success is True
    assert result.content == "完成"
    assert tool_calls_received == [("noop", "c1", 1)]


@pytest.mark.asyncio
async def test_executor_cancel_at_turn_start():
    """取消检查点 1 (turn 开始): 第 2 轮开始时 cancelled=True → 返回 cancelled 结果。"""
    provider = _StreamFakeProvider(
        responses=[
            [StreamChunk(type="delta", text="第一轮")],
            # 第 2 轮不会真正执行（取消）
            [StreamChunk(type="delta", text="第二轮")],
        ]
    )
    registry = ToolRegistry()
    # 第 1 次检查（第 1 轮开始）返回 False，第 2 次（第 2 轮开始）返回 True
    cancel_flags = [False, True]

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        cancelled_callback=lambda: cancel_flags.pop(0) if cancel_flags else False,
    )

    result = await executor.run("测试任务")

    assert result.success is False
    assert result.cancelled is True
    assert "取消" in (result.error or "")


@pytest.mark.asyncio
async def test_executor_cancel_mid_stream():
    """取消检查点 2 (流内 chunk 间): 取消信号在流式过程中触发 → 立即中断。"""
    # 第 1 轮流式中途取消
    provider = _StreamFakeProvider(
        responses=[
            [StreamChunk(type="delta", text="部"), StreamChunk(type="delta", text="分")],
        ]
    )
    registry = ToolRegistry()
    call_count = {"n": 0}

    def cancelled():
        # 第 3 次检查（进入第 1 轮流式的某个 chunk 后）返回 True
        call_count["n"] += 1
        return call_count["n"] >= 3

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        cancelled_callback=cancelled,
    )

    result = await executor.run("测试任务")

    assert result.success is False
    assert result.cancelled is True


# =============================================================================
# D1: tool_call 去重守卫（防 Ollama 无 id 多行重复导致同一动作多次执行）
# =============================================================================


@pytest.mark.asyncio
async def test_dedup_same_tool_no_id_executed_once():
    """D1: 同一 StreamChunk 内两条相同 name+args 但无 id 的 tool_call → 只执行一次。

    模拟 Ollama 多行重复场景（Ollama 的 tool_call id 通常为空）。
    """
    call_count = 0

    async def counter(args):  # noqa: ARG001
        nonlocal call_count
        call_count += 1
        return {"success": True}

    provider = _StreamFakeProvider(
        responses=[
            [
                StreamChunk(
                    type="tool_calls",
                    tool_calls=[
                        {"id": "", "function": {"name": "counter", "arguments": "{}"}},
                        {"id": "", "function": {"name": "counter", "arguments": "{}"}},
                    ],
                )
            ],
            [StreamChunk(type="delta", text="完成")],
        ]
    )
    registry = ToolRegistry()
    registry.register("counter", "计数工具", {"type": "object", "properties": {}}, counter)

    executor = AgentExecutor(provider=provider, registry=registry)
    await executor.run("测试")

    assert call_count == 1, f"重复的无 id tool_call 应去重，但执行了 {call_count} 次"


@pytest.mark.asyncio
async def test_dedup_different_args_no_id_both_executed():
    """D1: 无 id 但 args 不同的两条 tool_call → 都执行（不过度去重）。"""
    seen_args = []

    async def recorder(args):
        seen_args.append(args)
        return {"success": True}

    provider = _StreamFakeProvider(
        responses=[
            [
                StreamChunk(
                    type="tool_calls",
                    tool_calls=[
                        {"id": "", "function": {"name": "recorder", "arguments": '{"x": 1}'}},
                        {"id": "", "function": {"name": "recorder", "arguments": '{"x": 2}'}},
                    ],
                )
            ],
            [StreamChunk(type="delta", text="完成")],
        ]
    )
    registry = ToolRegistry()
    registry.register("recorder", "记录工具", {"type": "object", "properties": {}}, recorder)

    executor = AgentExecutor(provider=provider, registry=registry)
    await executor.run("测试")

    assert len(seen_args) == 2, f"不同 args 应都执行，但只执行了 {len(seen_args)} 次"


@pytest.mark.asyncio
async def test_dedup_same_id_fast_path():
    """D1: 有 id 的重复走快路径去重（id 优先）。"""
    call_count = 0

    async def counter(args):  # noqa: ARG001
        nonlocal call_count
        call_count += 1
        return {"success": True}

    provider = _StreamFakeProvider(
        responses=[
            [
                StreamChunk(
                    type="tool_calls",
                    tool_calls=[
                        {"id": "call_1", "function": {"name": "counter", "arguments": "{}"}},
                        {"id": "call_1", "function": {"name": "counter", "arguments": "{}"}},
                    ],
                )
            ],
            [StreamChunk(type="delta", text="完成")],
        ]
    )
    registry = ToolRegistry()
    registry.register("counter", "计数工具", {"type": "object", "properties": {}}, counter)

    executor = AgentExecutor(provider=provider, registry=registry)
    await executor.run("测试")

    assert call_count == 1, f"相同 id 应去重，但执行了 {call_count} 次"
