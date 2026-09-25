# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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


def test_emit_drops_live_frame_when_queue_full_but_journals(tmp_path: Path):
    """队列满员时 emit 丢弃实时帧：不阻塞、不抛错，journal 仍完整落盘。

    SSE 断开宽限期内队列无人消费（挂起确认 300s × N + LLM 流式），
    有界队列的丢弃守卫真实可达——journal 是权威全量记录，丢实时帧无正确性影响。
    """
    journal = EventJournal(job_id="job_qfull", journal_dir=str(tmp_path))
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    queue.put_nowait({"id": 0, "event": "delta", "data": {}})  # 占满队列
    orch = StreamingOrchestrator(job_id="job_qfull", journal=journal, cancel_event=asyncio.Event(), event_queue=queue)

    # 满员后连续 emit：返回正常 id、不抛 QueueFull、不阻塞
    assert orch.emit("delta", {"text": "a"}) == 1
    assert orch.emit("tool_call", {"tool": "noop"}) == 2

    # journal 完整记录全部事件（权威全量，重连/终态快照的前提）
    events = journal.read_all()
    assert [e[1] for e in events] == ["delta", "tool_call"]
    # 实时帧被丢弃：队列仍只有占位的 1 条
    assert queue.qsize() == 1
    assert queue.get_nowait()["id"] == 0


def test_emit_pushes_live_frame_when_queue_has_room(tmp_path: Path):
    """队列未满时实时帧正常入队（丢弃守卫不影响正常投递路径）。"""
    journal = EventJournal(job_id="job_qroom", journal_dir=str(tmp_path))
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    orch = StreamingOrchestrator(job_id="job_qroom", journal=journal, cancel_event=asyncio.Event(), event_queue=queue)

    eid = orch.emit("started", {"job_id": "job_qroom"})
    assert eid == 1
    assert queue.qsize() == 1
    assert queue.get_nowait() == {"id": 1, "event": "started", "data": {"job_id": "job_qroom"}}


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


@pytest.mark.asyncio
async def test_run_chat_bridges_ask_user_events(orchestrator: StreamingOrchestrator):
    """run_chat 把 ask_user 的回调桥接为 user_input_requested / user_responded 事件。

    验证 ask 交互的编排层桥接（与 frontend_instruction 桥接对称）：
    - ChatAgentRunner 接收的 ask_callbacks 含 on_user_input_requested / on_user_responded
    - 调用这些回调时，orchestrator emit 对应 SSE 事件
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

    # 从被 patch 的类构造调用中提取 ask_callbacks
    init_kwargs = mock_runner_cls.call_args.kwargs
    ask_callbacks = init_kwargs["ask_callbacks"]
    assert ask_callbacks.on_user_input_requested is not None
    assert ask_callbacks.on_user_responded is not None

    # 调用 on_user_input_requested 桥接回调，验证 emit 出 user_input_requested 事件
    request_payload = {
        "ask_id": "job_test#ask#1",
        "question_type": "choice",
        "prompt": "选哪个?",
        "options": [{"label": "A", "value": "a"}],
    }
    ask_callbacks.on_user_input_requested(request_payload)

    # 调用 on_user_responded 桥接回调，验证 emit 出 user_responded 事件
    responded_payload = {"ask_id": "job_test#ask#1", "response": {"answer": "a"}}
    ask_callbacks.on_user_responded(responded_payload)

    events = orchestrator.journal.read_all()
    req_events = [e for e in events if e[1] == "user_input_requested"]
    resp_events = [e for e in events if e[1] == "user_responded"]
    assert len(req_events) == 1
    assert req_events[0][2] == request_payload
    assert len(resp_events) == 1
    assert resp_events[0][2] == responded_payload


# =============================================================================
# 终态资源清理测试（SSE 断开宽限期配套：任务到达终态后 controller/登记的回收路径）
# =============================================================================


@pytest.mark.asyncio
async def test_run_chat_completion_after_disconnect_keeps_journaling_and_cleans_up(tmp_path):
    """断开宽限期的资源回收：SSE 断开后任务跑完——事件持续落盘、终态清理无残留。

    契约（reviewer 视角）：
    - 断开不取消任务：runner 正常执行完毕，completed 事件仍写入 journal（续传/审计前提）
    - 终态清理：job 的失联登记被注销（后续新 controller 不再被误标 disconnected）
    """
    import app.shared.services.ai.streaming.pending_interaction_store as store_mod
    from app.shared.services.ai.streaming.pending_interaction_store import (
        ConfirmController,
        get_global_pending_interaction_store,
    )

    journal = EventJournal(job_id="job_grace_done", journal_dir=str(tmp_path))
    orch = StreamingOrchestrator(job_id="job_grace_done", journal=journal, cancel_event=asyncio.Event())
    store = get_global_pending_interaction_store()
    store.mark_job_client_gone("job_grace_done")
    try:
        fake_runner = _make_fake_runner(reply="完成")
        with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
            await orch.run_chat(
                message="测试",
                history=None,
                provider=MagicMock(),
                project_path="/tmp",
                context_nodes=[],
            )

        # 断开后任务照常跑完并落盘终态事件
        events = journal.read_all()
        assert events[-1][1] == "completed"
        assert events[-1][2]["reply"] == "完成"
    finally:
        store.pop_by_job_prefix("job_grace_done")

    # 终态清理已注销失联登记：新 controller 超时兜底判 timeout（而非 disconnected）
    monkey_timeout = pytest.MonkeyPatch()
    try:
        monkey_timeout.setattr(store_mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
        ctrl = ConfirmController(request_id="job_grace_done#apply#9")
        store.put("job_grace_done#apply#9", ctrl)
        assert await ctrl.await_outcome() == {"decision": "timeout"}
    finally:
        monkey_timeout.undo()
        store.pop_by_job_prefix("job_grace_done")


@pytest.mark.asyncio
async def test_run_chat_cancellation_resolves_leftover_interactions_as_disconnected(tmp_path):
    """任务被取消时 finally 兜底唤醒残留交互：apply 记 disconnected（非用户拒绝）。"""
    from app.shared.services.ai.streaming.pending_interaction_store import (
        ConfirmController,
        InteractionController,
        get_global_pending_interaction_store,
    )

    journal = EventJournal(job_id="job_cancel_clean", journal_dir=str(tmp_path))
    orch = StreamingOrchestrator(job_id="job_cancel_clean", journal=journal, cancel_event=asyncio.Event())
    store = get_global_pending_interaction_store()
    apply_ctrl = ConfirmController(request_id="job_cancel_clean#apply#1")
    ask_ctrl = InteractionController(request_id="job_cancel_clean#ask#1")
    store.put("job_cancel_clean#apply#1", apply_ctrl)
    store.put("job_cancel_clean#ask#1", ask_ctrl)
    try:
        # 模拟后台任务被取消（服务关停/异常）：CancelledError 穿透 except Exception，
        # finally 兜底清理必须执行（宽限期下僵尸任务/泄漏的防线）
        fake_runner = _make_fake_runner(side_effect=asyncio.CancelledError())
        with patch("app.shared.services.ai.streaming.orchestrator.ChatAgentRunner", return_value=fake_runner):
            with pytest.raises(asyncio.CancelledError):
                await orch.run_chat(
                    message="测试",
                    history=None,
                    provider=MagicMock(),
                    project_path="/tmp",
                    context_nodes=[],
                )

        # 残留交互已被兜底决议：apply 记 disconnected（任务终止，非用户决策），
        # ask 记 {skipped, reason: cancelled}——两者文案均不得表述成"用户拒绝/跳过"
        assert apply_ctrl.is_resolved is True
        assert apply_ctrl.decision == "disconnected"
        assert ask_ctrl.is_resolved is True
        assert ask_ctrl.response == {"skipped": True, "reason": "cancelled"}
        # store 中该 job 的控制器已弹出（终态清理路径 pop_by_job_prefix）
        assert store.get("job_cancel_clean#apply#1") is None
        assert store.get("job_cancel_clean#ask#1") is None
        assert store.get_all_by_job("job_cancel_clean") == []
    finally:
        store.pop_by_job_prefix("job_cancel_clean")
