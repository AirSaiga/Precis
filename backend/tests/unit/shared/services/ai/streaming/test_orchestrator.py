"""@fileoverview StreamingOrchestrator 单元测试

验证 run_chat 包装 runner 为事件流、emit 落盘、取消检测、终止事件、回调桥接。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.ai.chat_agent_runner import ChatAgentRunResult
from app.shared.services.ai.streaming.event_journal import EventJournal
from app.shared.services.ai.streaming.orchestrator import StreamingOrchestrator


@pytest.fixture
def orchestrator(tmp_path: Path) -> StreamingOrchestrator:
    """每个测试用独立的临时 journal 目录与 cancel_event。"""
    journal = EventJournal(job_id="job_test", journal_dir=str(tmp_path))
    cancel_event = asyncio.Event()
    return StreamingOrchestrator(job_id="job_test", journal=journal, cancel_event=cancel_event)


def _make_fake_runner(
    reply="完成",
    success=True,
    iterations=1,
    error=None,
    cancelled=False,
    side_effect=None,
):
    """构造 mock runner，run 用 AsyncMock。

    用真实的 ChatAgentRunResult dataclass（而非 MagicMock）构造结果，
    避免 MagicMock 的 getattr 在不同 Python 版本上对 cancelled 等字段的歧义。
    """
    # 用真实 dataclass，确保 getattr(result, "cancelled", False) 行为确定
    fake_result = ChatAgentRunResult(
        reply=reply,
        frontend_instructions=[],
        actions=[],
        tool_steps=[{"tool": "noop", "label": "无操作", "turn": 1}],
        iterations=iterations,
        success=success,
        error=error,
    )
    # ChatAgentRunResult 没有 cancelled 字段，用对象属性附加（getattr 默认值兜底）
    # 注意：orchestrator 用 getattr(result, "cancelled", False)，dataclass 无此属性 → 返回 False
    # 若需要模拟取消，应设置 cancel_event 而非 result.cancelled

    fake_runner = MagicMock()
    if side_effect is not None:
        fake_runner.run = AsyncMock(side_effect=side_effect)
    else:
        fake_runner.run = AsyncMock(return_value=fake_result)
    return fake_runner


def test_emit_appends_to_journal(orchestrator: StreamingOrchestrator):
    """emit 把事件追加到 journal。"""
    eid = orchestrator.emit("delta", {"text": "a"})
    assert eid == 1
    events = orchestrator.journal.read_all()
    assert len(events) == 1
    assert events[0] == (1, "delta", {"text": "a"})


def test_emit_returns_incrementing_ids(orchestrator: StreamingOrchestrator):
    """多次 emit 返回递增 id。"""
    assert orchestrator.emit("started", {}) == 1
    assert orchestrator.emit("delta", {"text": "a"}) == 2
    assert orchestrator.emit("completed", {}) == 3


@pytest.mark.asyncio
async def test_run_chat_emits_started_delta_completed(orchestrator: StreamingOrchestrator):
    """run_chat 包装 runner,发出 started → delta(逐字) → completed 事件。"""
    fake_runner = _make_fake_runner(reply="完成")

    with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
        await orchestrator.run_chat(
            message="测试",
            history=None,
            provider=MagicMock(),
            project_path="/tmp",
            context_nodes=[],
        )

    # 验证事件序列
    events = orchestrator.journal.read_all()
    event_types = [e[1] for e in events]
    assert event_types[0] == "started"
    assert event_types[-1] == "completed"
    # completed 应携带完整快照
    completed_data = events[-1][2]
    assert completed_data["reply"] == "完成"
    assert completed_data["tool_steps"] == [{"tool": "noop", "label": "无操作", "turn": 1}]


@pytest.mark.asyncio
async def test_run_chat_emits_cancelled_on_cancel(orchestrator: StreamingOrchestrator):
    """cancel_event 被 set 后,run_chat 发出 cancelled 事件。"""
    # runner 返回 success=False 但 iterations=2（模拟中途取消）
    fake_runner = _make_fake_runner(reply="", success=False, iterations=2)

    with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
        # 设置取消信号
        orchestrator.cancel_event.set()
        await orchestrator.run_chat(
            message="测试",
            history=None,
            provider=MagicMock(),
            project_path="/tmp",
            context_nodes=[],
        )

    events = orchestrator.journal.read_all()
    event_types = [e[1] for e in events]
    assert event_types[-1] == "cancelled"
    cancelled_data = events[-1][2]
    assert cancelled_data["completed_turns"] == 2
    assert cancelled_data["partial"] is True


@pytest.mark.asyncio
async def test_run_chat_emits_error_on_exception(orchestrator: StreamingOrchestrator):
    """runner 抛异常时,run_chat 发出 error 事件。"""
    fake_runner = _make_fake_runner(side_effect=RuntimeError("LLM 挂了"))

    with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
        await orchestrator.run_chat(
            message="测试",
            history=None,
            provider=MagicMock(),
            project_path="/tmp",
            context_nodes=[],
        )

    events = orchestrator.journal.read_all()
    assert events[-1][1] == "error"
    assert "LLM 挂了" in events[-1][2]["message"]


@pytest.mark.asyncio
async def test_run_chat_emits_error_on_failed_result(orchestrator: StreamingOrchestrator):
    """runner 返回 success=False 且未取消时,run_chat 发出 error 事件。"""
    fake_runner = _make_fake_runner(reply="", success=False, iterations=0, error="LLM 拒绝响应")

    with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
        await orchestrator.run_chat(
            message="测试",
            history=None,
            provider=MagicMock(),
            project_path="/tmp",
            context_nodes=[],
        )

    events = orchestrator.journal.read_all()
    assert events[-1][1] == "error"
    assert events[-1][2]["message"] == "LLM 拒绝响应"


@pytest.mark.asyncio
async def test_run_chat_injects_callbacks_to_runner(orchestrator: StreamingOrchestrator):
    """run_chat 通过 configure_callbacks 把 emit 桥接注入 runner。"""
    fake_runner = _make_fake_runner(reply="ok")

    with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
        await orchestrator.run_chat(
            message="测试",
            history=None,
            provider=MagicMock(),
            project_path="/tmp",
            context_nodes=[],
        )

    # 验证 configure_callbacks 被调用
    fake_runner.configure_callbacks.assert_called_once()
    callbacks = fake_runner.configure_callbacks.call_args.kwargs
    # 应包含所有回调键
    assert "on_chunk" in callbacks
    assert "on_turn" in callbacks
    assert "on_tool_call" in callbacks
    assert "on_tool_result" in callbacks
    assert "cancelled" in callbacks
    # on_chunk 回调应能触发 emit(产生 delta 事件)
    callbacks["on_chunk"]("片段")
    events = orchestrator.journal.read_all()
    delta_events = [e for e in events if e[1] == "delta"]
    assert any(e[2].get("text") == "片段" for e in delta_events)


@pytest.mark.asyncio
async def test_run_chat_bridges_frontend_instruction(orchestrator: StreamingOrchestrator):
    """run_chat 把 apply_actions 的 on_frontend_instruction 桥接为 frontend_instruction 事件。

    验证流式画布生长的编排层桥接：
    - ChatAgentRunner 接收的 apply_callbacks 含 on_frontend_instruction
    - 调用该回调时，orchestrator emit 一个 frontend_instruction 事件，
      payload 形如 {"instruction": {...}}
    """
    fake_runner = _make_fake_runner(reply="ok")

    with patch(
        "app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner
    ) as mock_runner_cls:
        await orchestrator.run_chat(
            message="测试",
            history=None,
            provider=MagicMock(),
            project_path="/tmp",
            context_nodes=[],
        )

    # 从被 patch 的类构造调用中提取 apply_callbacks（mock_runner_cls 记录 ChatAgentRunner(...) 调用）
    init_kwargs = mock_runner_cls.call_args.kwargs
    apply_callbacks = init_kwargs["apply_callbacks"]
    assert apply_callbacks.on_frontend_instruction is not None

    # 调用桥接回调，验证 emit 出 frontend_instruction 事件
    sample_instruction = {"actionType": "ADD_CONSTRAINT_NODE"}
    apply_callbacks.on_frontend_instruction({"instruction": sample_instruction})

    events = orchestrator.journal.read_all()
    fi_events = [e for e in events if e[1] == "frontend_instruction"]
    assert len(fi_events) == 1
    assert fi_events[0][2] == {"instruction": sample_instruction}
