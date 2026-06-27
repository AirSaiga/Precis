"""@fileoverview AgentExecutor checkpoint 续跑测试

覆盖 run() 用 initial_checkpoint 从断点继续、无 checkpoint 时回归保护、checkpoint_callback 异常不中断。
- 首次 run 2 轮 → checkpoint_callback 被调 2 次,每次含 messages
- 用第 2 轮 checkpoint 调 run(initial_checkpoint=cp) → 从 turn 3 继续,不重复前 2 轮
- 无 initial_checkpoint → 新建 memory(start_turn=1),行为不变
- checkpoint_callback 抛异常不中断 run()
- _make_checkpoint 含 messages 字段
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse, StreamChunk


class _StreamFakeProvider(BaseProvider):
    """模拟 Provider，按预设 StreamChunk 序列返回（按轮次消费）。"""

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

    async def chat(self, req: ChatRequest) -> ChatResponse:  # pragma: no cover
        return ChatResponse(content="", model="fake")

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        for chunk in self.responses[self.call_index]:
            yield chunk
        self.call_index += 1

    async def list_models(self) -> list[str]:
        return ["fake"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}


def _make_registry_with_noop() -> ToolRegistry:
    """构造含 noop 工具的 registry。"""
    registry = ToolRegistry()
    registry.register("noop", "测试工具", {"type": "object", "properties": {}}, lambda args: {"success": True})
    return registry


@pytest.mark.asyncio
async def test_executor_checkpoint_callback_called_each_turn_with_messages():
    """首次 run 2 轮 → checkpoint_callback 被调 2 次,每次含 messages。"""
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
    registry = _make_registry_with_noop()
    checkpoints: list[dict] = []

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        checkpoint_callback=lambda cp: checkpoints.append(cp),
    )

    result = await executor.run("测试任务")

    assert result.success is True
    assert len(checkpoints) == 2, f"应调用 2 次 checkpoint_callback,实际 {len(checkpoints)}"
    for cp in checkpoints:
        assert "messages" in cp, "checkpoint 必须含 messages 字段"
        assert isinstance(cp["messages"], list)
        assert len(cp["messages"]) > 0, "messages 不应为空"


@pytest.mark.asyncio
async def test_executor_resume_from_checkpoint_continues_from_next_turn():
    """用第 2 轮 checkpoint 调 run(initial_checkpoint=cp) → 从 turn 3 继续,不重复前 2 轮。"""
    # 首次运行 2 轮
    provider1 = _StreamFakeProvider(
        responses=[
            [
                StreamChunk(
                    type="tool_calls", tool_calls=[{"id": "c1", "function": {"name": "noop", "arguments": "{}"}}]
                )
            ],
            [
                StreamChunk(
                    type="tool_calls", tool_calls=[{"id": "c2", "function": {"name": "noop", "arguments": "{}"}}]
                )
            ],
        ]
    )
    registry1 = _make_registry_with_noop()
    checkpoints: list[dict] = []

    executor1 = AgentExecutor(
        provider=provider1,
        registry=registry1,
        checkpoint_callback=lambda cp: checkpoints.append(cp),
    )

    await executor1.run("测试任务")

    assert len(checkpoints) == 2
    checkpoint_after_turn_2 = checkpoints[1]

    # 续跑:从 turn 3 继续
    provider2 = _StreamFakeProvider(
        responses=[
            [StreamChunk(type="delta", text="续跑完成")],
        ]
    )
    registry2 = _make_registry_with_noop()
    turns_received: list[int] = []

    executor2 = AgentExecutor(
        provider=provider2,
        registry=registry2,
        on_turn=lambda n: turns_received.append(n),
    )

    result = await executor2.run("测试任务", initial_checkpoint=checkpoint_after_turn_2)

    assert result.success is True
    assert result.content == "续跑完成"
    assert turns_received == [3], f"应从 turn 3 继续,实际 {turns_received}"
    # 验证 memory 含前 2 轮记录
    assert executor2._memory is not None
    assert executor2._memory._turn_count == 3, "续跑后 turn_count 应为 3"


@pytest.mark.asyncio
async def test_executor_no_initial_checkpoint_starts_from_turn_1():
    """无 initial_checkpoint → 新建 memory(start_turn=1),行为不变(回归保护)。"""
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
    registry = _make_registry_with_noop()
    turns_received: list[int] = []

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        on_turn=lambda n: turns_received.append(n),
    )

    result = await executor.run("测试任务")

    assert result.success is True
    assert turns_received == [1, 2], f"应从 turn 1 开始,实际 {turns_received}"
    assert executor._memory is not None
    assert executor._memory._turn_count == 2


@pytest.mark.asyncio
async def test_executor_checkpoint_callback_exception_does_not_interrupt():
    """checkpoint_callback 抛异常不中断 run()。"""
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
    registry = _make_registry_with_noop()
    call_count = {"n": 0}

    def failing_checkpoint(cp):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("checkpoint 落盘失败")

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        checkpoint_callback=failing_checkpoint,
    )

    result = await executor.run("测试任务")

    assert result.success is True, "checkpoint_callback 异常不应中断 run()"
    assert call_count["n"] == 2, "checkpoint_callback 应被调用 2 次"


@pytest.mark.asyncio
async def test_executor_make_checkpoint_contains_messages():
    """_make_checkpoint 返回值含 messages 字段。"""
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
    registry = _make_registry_with_noop()
    checkpoints: list[dict] = []

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        checkpoint_callback=lambda cp: checkpoints.append(cp),
    )

    await executor.run("测试任务")

    assert len(checkpoints) >= 1
    cp = checkpoints[0]
    assert "messages" in cp, "_make_checkpoint 必须含 messages 字段"
    assert "turn" in cp, "_make_checkpoint 必须含 turn 字段"
    assert cp["turn"] == 1


@pytest.mark.asyncio
async def test_executor_resume_with_empty_messages_falls_back_to_new_memory():
    """initial_checkpoint 无 messages → 回退到新建 memory(兼容老 checkpoint)。"""
    provider = _StreamFakeProvider(
        responses=[
            [StreamChunk(type="delta", text="完成")],
        ]
    )
    registry = _make_registry_with_noop()
    turns_received: list[int] = []

    executor = AgentExecutor(
        provider=provider,
        registry=registry,
        on_turn=lambda n: turns_received.append(n),
    )

    old_checkpoint = {"turn_count": 2, "message_count": 5, "messages": []}
    result = await executor.run("测试任务", initial_checkpoint=old_checkpoint)

    assert result.success is True
    assert turns_received == [1], f"空 messages 应回退到新建 memory,实际 {turns_received}"
