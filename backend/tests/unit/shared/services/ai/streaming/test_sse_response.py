"""@fileoverview SSE 响应封装测试

验证 SSE 帧格式化、续传逻辑(read_since)、已完成任务的回放、心跳。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.shared.services.ai.streaming.event_journal import EventJournal
from app.shared.services.ai.streaming.sse_response import (
    format_sse_event,
    sse_event_stream,
)


def test_format_sse_event_with_id_and_event():
    """格式化带 id 和 event 类型的 SSE 帧。"""
    frame = format_sse_event(event_id=5, event="delta", data={"text": "你好"})
    assert "id: 5\n" in frame
    assert "event: delta\n" in frame
    assert 'data: {"text": "你好"}\n' in frame
    assert frame.endswith("\n\n")


def test_format_sse_event_completed():
    """completed 事件帧包含完整 data JSON。"""
    frame = format_sse_event(event_id=3, event="completed", data={"reply": "完成", "tool_steps": []})
    assert "id: 3\n" in frame
    assert "event: completed\n" in frame
    assert '"reply": "完成"' in frame


def test_format_sse_heartbeat():
    """心跳帧是 SSE 注释行(以 : 开头,不计为事件)。"""
    frame = format_sse_event(event_id=None, event=None, data=None, heartbeat=True)
    assert frame.startswith(":")
    assert "keep-alive" in frame


@pytest.mark.asyncio
async def test_sse_event_stream_replays_since_last_id(tmp_path: Path):
    """续传: 从 Last-Event-ID+1 开始回放 journal 中已有事件。"""
    journal = EventJournal(job_id="job1", journal_dir=str(tmp_path))
    journal.append("started", {})  # id=1
    journal.append("delta", {"text": "a"})  # id=2
    journal.append("delta", {"text": "b"})  # id=3
    journal.append("completed", {"reply": "ab"})  # id=4

    # 模拟客户端断线后重连,Last-Event-ID=2
    frames: list[str] = []
    async for frame in sse_event_stream(journal=journal, last_event_id=2, live_timeout=0.01):
        frames.append(frame)
        # completed 是终止事件,收到后停止
        if "event: completed" in frame:
            break

    # 应只回放 id=3,4
    assert "id: 3" in "\n".join(frames)
    assert "id: 4" in "\n".join(frames)
    assert "id: 1" not in "\n".join(frames)
    assert "id: 2" not in "\n".join(frames)


@pytest.mark.asyncio
async def test_sse_event_stream_replays_all_when_terminated(tmp_path: Path):
    """已完成任务重连: journal 最后是终止事件,回放全部后关闭。"""
    journal = EventJournal(job_id="job1", journal_dir=str(tmp_path))
    journal.append("delta", {"text": "x"})  # id=1
    journal.append("completed", {"reply": "x"})  # id=2

    # last_event_id=0,且 journal 已 terminated
    frames: list[str] = []
    async for frame in sse_event_stream(journal=journal, last_event_id=0, live_timeout=0.01):
        frames.append(frame)

    # 应回放 id=1,2 后自动结束(journal 已 terminated)
    assert "id: 1" in "\n".join(frames)
    assert "id: 2" in "\n".join(frames)
    assert "event: completed" in "\n".join(frames)
