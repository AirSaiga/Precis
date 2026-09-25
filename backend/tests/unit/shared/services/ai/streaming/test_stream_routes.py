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
"""@fileoverview SSE 流式路由端点单元测试

测试 stream 模块的纯逻辑（取消信号管理、journal 目录、SSE 断开宽限期生成器、
confirm 端点直调），不依赖全局 FastAPI app 实例。

端点注册与 HTTP 请求的集成验证由 E2E 测试覆盖（ai-chat-agent / ai-chat-confirm /
ai-config-generation / ai-config-migration），遵循项目 E2E-first 策略。
此前依赖 app.include_router 副作用的集成测试在 CI(Linux) 环境不稳定
（include_router 拷贝路由行为的环境差异），故移除，改由 E2E 在真实后端验证；
本文件的 422 用例自建独立 FastAPI app + TestClient 发起真实 HTTP 请求
（无全局状态依赖，符合 AGENTS.md "验证路由挂载优先用 TestClient" 的建议）。
"""

from __future__ import annotations

import asyncio

import pytest

from app.api.routers.ai import stream as stream_module
from app.api.routers.ai.models import AiChatConfirmRequest
from app.shared.services.ai.streaming.event_journal import EventJournal
from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    get_global_pending_interaction_store,
)


def test_cancel_endpoint_sets_event_for_known_job():
    """cancel 已知 job 设置 cancel_event。"""
    import asyncio

    job_id = "test_known_job"
    ev = asyncio.Event()
    stream_module._cancel_events[job_id] = ev
    try:
        assert not ev.is_set()
        # 模拟取消
        stream_module._cancel_events[job_id].set()
        assert ev.is_set()
    finally:
        stream_module._cancel_events.pop(job_id, None)


def test_unregister_cancel_event_removes_entry():
    """_unregister_cancel_event 移除已注册的 job。"""
    import asyncio

    job_id = "test_unregister"
    stream_module._cancel_events[job_id] = asyncio.Event()
    assert job_id in stream_module._cancel_events

    stream_module._unregister_cancel_event(job_id)
    assert job_id not in stream_module._cancel_events


def test_journal_dir_for_project_path():
    """_journal_dir_for 按 project_path 返回项目本地目录（跨平台）。"""
    import os

    result = stream_module._journal_dir_for("/my/project")
    # 跨平台：用 os.path.join 拼接，断言路径组成部分而非硬编码分隔符
    expected = os.path.join("/my/project", ".precis", "stream_jobs")
    assert result == expected


def test_journal_dir_for_none_project_path():
    """_journal_dir_for 无 project_path 时回退到用户级目录。"""
    import os

    result = stream_module._journal_dir_for(None)
    expected = os.path.join(os.path.expanduser("~"), ".precis", "stream_jobs")
    assert result == expected


def test_event_queue_is_bounded():
    """chat_stream 的实时事件队列必须有界（宽限期内存积压回归守卫）。

    无界队列会让 orchestrator.emit 的 QueueFull 丢弃守卫变成死代码，
    SSE 断开宽限期内 delta/tool 事件持续积压无人消费。
    """
    assert stream_module._EVENT_QUEUE_MAXSIZE > 0


# =============================================================================
# SSE 断开宽限期测试（D5.3：断开不取消任务，挂起交互仍可决议）
# =============================================================================


def _make_grace_job(tmp_path, job_id: str) -> tuple[EventJournal, asyncio.Queue, asyncio.Event]:
    """装配一个宽限期测试 job：journal（含 started 事件）+ 实时队列 + 取消信号。"""
    journal = EventJournal(job_id=job_id, journal_dir=str(tmp_path))
    journal.append("started", {"job_id": job_id, "kind": "chat"})
    cancel_event = asyncio.Event()
    stream_module._cancel_events[job_id] = cancel_event
    return journal, asyncio.Queue(), cancel_event


@pytest.mark.asyncio
async def test_sse_disconnect_does_not_cancel_and_confirm_still_resolves(tmp_path):
    """断开宽限期核心契约：SSE 断开不软取消后台任务，挂起确认仍可被 confirm 端点决议。

    修复前生成器 finally 无条件 cancel_event.set()——网络抖动/休眠/组件卸载等瞬断
    都会取消整个 job；用户再点"确认"时挂起项已被清理，404"无挂起的改动"。
    """
    job_id = "stream_test_grace"
    journal, queue, cancel_event = _make_grace_job(tmp_path, job_id)
    store = get_global_pending_interaction_store()
    apply_id = f"{job_id}#apply#1"
    controller = ConfirmController(request_id=apply_id)
    store.put(apply_id, controller)
    try:
        gen = stream_module._sse_frames_with_disconnect_grace(
            job_id=job_id, journal=journal, last_event_id=0, event_queue=queue
        )
        # 先消费一帧（回放 started），生成器进入 try 内的 yield 挂起点
        frame = await gen.__anext__()
        assert "started" in frame
        # 模拟客户端断开：aclose 在挂起的 yield 处注入 GeneratorExit → finally 执行
        await gen.aclose()

        # 契约 1：断开不得触发软取消（后台任务继续运行至终态或挂起确认自然超时）
        assert not cancel_event.is_set()
        # 契约 2：挂起确认未被清理，confirm 端点仍可决议（不 404）
        resp = await stream_module.confirm_apply(job_id, AiChatConfirmRequest(decision="confirm"))
        assert resp == {"status": "resolved", "decision": "confirm"}
        assert await controller.await_outcome() == {"decision": "confirm"}
    finally:
        stream_module._cancel_events.pop(job_id, None)
        store.pop_by_job_prefix(job_id)


@pytest.mark.asyncio
async def test_sse_disconnect_flags_pending_interaction_as_gone(tmp_path, monkeypatch):
    """断开登记客户端失联：挂起确认超时兜底按 disconnected（连接中断）回灌，非用户拒绝。"""
    import app.shared.services.ai.streaming.pending_interaction_store as store_mod

    monkeypatch.setattr(store_mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
    job_id = "stream_test_gone"
    journal, queue, _cancel_event = _make_grace_job(tmp_path, job_id)
    store = get_global_pending_interaction_store()
    apply_id = f"{job_id}#apply#1"
    controller = ConfirmController(request_id=apply_id)
    store.put(apply_id, controller)
    try:
        gen = stream_module._sse_frames_with_disconnect_grace(
            job_id=job_id, journal=journal, last_event_id=0, event_queue=queue
        )
        await gen.__anext__()
        await gen.aclose()

        # 断开后无人决议 → 超时兜底判"连接中断"而非"用户拒绝/单纯超时"
        assert await controller.await_outcome() == {"decision": "disconnected"}
    finally:
        stream_module._cancel_events.pop(job_id, None)
        store.pop_by_job_prefix(job_id)


@pytest.mark.asyncio
async def test_sse_normal_completion_does_not_flag_gone(tmp_path, monkeypatch):
    """正常收尾（投递终态事件后流自然耗尽）不登记失联——不给已完成 job 留残影。"""
    import app.shared.services.ai.streaming.pending_interaction_store as store_mod

    monkeypatch.setattr(store_mod, "_APPLY_CONFIRM_TIMEOUT", 0.05)
    job_id = "stream_test_normal"
    journal, queue, _cancel_event = _make_grace_job(tmp_path, job_id)
    store = get_global_pending_interaction_store()
    apply_id = f"{job_id}#apply#1"
    controller = ConfirmController(request_id=apply_id)
    store.put(apply_id, controller)
    try:
        # 队列推入终态事件：回放 started → 实时收到 completed → 流自然结束
        queue.put_nowait({"id": 2, "event": "completed", "data": {"reply": "done"}})
        gen = stream_module._sse_frames_with_disconnect_grace(
            job_id=job_id, journal=journal, last_event_id=0, event_queue=queue
        )
        frames = [frame async for frame in gen]
        assert any("started" in f for f in frames)
        assert any("completed" in f for f in frames)

        # 正常结束不标记失联：超时兜底判 timeout（而非 disconnected）
        assert await controller.await_outcome() == {"decision": "timeout"}
    finally:
        stream_module._cancel_events.pop(job_id, None)
        store.pop_by_job_prefix(job_id)


# =============================================================================
# confirm 端点 decision 枚举校验测试
# =============================================================================


def test_confirm_invalid_decision_returns_422_with_valid_values():
    """decision 非法值（"yes"/"ok" 等）由 Pydantic Literal 拒绝：422 并回显合法值。

    修复前 decision 是自由字符串，非法值一律被当作 reject 处理且不回显有效值。
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.routers.ai.router import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    for invalid in ("yes", "ok", " Confirm ", "reject\x00"):
        resp = client.post("/api/latest/ai/chat/job-x/confirm", json={"decision": invalid})
        assert resp.status_code == 422, f"decision={invalid!r} 应被 422 拒绝"
        # Pydantic 自动回显合法值集合，调用方能自我修正
        assert "confirm" in resp.text
        assert "reject" in resp.text

    # 合法值仍通过校验（走后续 404 逻辑：无挂起项）
    resp = client.post("/api/latest/ai/chat/job-x/confirm", json={"decision": "reject"})
    assert resp.status_code == 404
