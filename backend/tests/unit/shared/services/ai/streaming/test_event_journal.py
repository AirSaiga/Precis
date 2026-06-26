"""@fileoverview EventJournal 单元测试

验证事件追加(递增 id)、续传读取(read_since)、全量读取、终止判定、清理。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.shared.services.ai.streaming.event_journal import EventJournal


@pytest.fixture
def journal(tmp_path: Path) -> EventJournal:
    """每个测试用独立的临时目录。"""
    return EventJournal(job_id="job_test", journal_dir=str(tmp_path))


def test_append_returns_incrementing_ids(journal: EventJournal):
    """append 返回从 1 开始递增的 id。"""
    id1 = journal.append("delta", {"text": "a"})
    id2 = journal.append("delta", {"text": "b"})
    id3 = journal.append("completed", {"reply": "ab"})
    assert id1 == 1
    assert id2 == 2
    assert id3 == 3


def test_read_all_returns_all_events(journal: EventJournal):
    """read_all 返回全部事件元组 (id, event, data)。"""
    journal.append("started", {"kind": "chat"})
    journal.append("delta", {"text": "x"})
    journal.append("completed", {"reply": "x"})

    events = journal.read_all()
    assert len(events) == 3
    assert events[0] == (1, "started", {"kind": "chat"})
    assert events[1] == (2, "delta", {"text": "x"})
    assert events[2] == (3, "completed", {"reply": "x"})


def test_read_since_returns_events_after_last_id(journal: EventJournal):
    """read_since(n) 返回 id > n 的事件(用于断线续传)。"""
    journal.append("started", {})
    journal.append("delta", {"text": "a"})  # id=2
    journal.append("delta", {"text": "b"})  # id=3
    journal.append("delta", {"text": "c"})  # id=4

    events = journal.read_since(last_id=2)
    assert len(events) == 2
    assert events[0] == (3, "delta", {"text": "b"})
    assert events[1] == (4, "delta", {"text": "c"})


def test_read_since_zero_returns_all(journal: EventJournal):
    """read_since(0) 等价于 read_all。"""
    journal.append("delta", {"text": "a"})
    journal.append("delta", {"text": "b"})

    events = journal.read_since(last_id=0)
    assert len(events) == 2


def test_read_all_empty_when_no_journal(journal: EventJournal):
    """未写入任何事件时,read_all 返回空列表。"""
    assert journal.read_all() == []


def test_is_terminated_detects_terminal_events(journal: EventJournal):
    """is_terminated 检测最后一条是否为终止事件(completed/error/cancelled)。"""
    journal.append("delta", {"text": "a"})
    assert journal.is_terminated() is False

    journal.append("completed", {"reply": "a"})
    assert journal.is_terminated() is True


def test_is_terminated_false_for_non_terminal(journal: EventJournal):
    """非终止事件结尾时 is_terminated 为 False。"""
    journal.append("started", {})
    journal.append("progress", {"stage": "running"})
    assert journal.is_terminated() is False


def test_is_terminated_for_error_and_cancelled(journal: EventJournal):
    """error 和 cancelled 也是终止事件。"""
    journal.append("error", {"message": "boom"})
    assert journal.is_terminated() is True

    j2 = EventJournal(job_id="job2", journal_dir=journal.journal_dir)
    j2.append("cancelled", {"turns": 1})
    assert j2.is_terminated() is True


def test_cleanup_deletes_journal_file(journal: EventJournal, tmp_path: Path):
    """cleanup 删除 journal 文件。"""
    journal.append("delta", {"text": "a"})
    journal_file = Path(journal.journal_path)
    assert journal_file.exists()

    journal.cleanup()

    assert not journal_file.exists()


def test_next_id_persists_across_instances(journal: EventJournal, tmp_path: Path):
    """新 EventJournal 实例从已有 journal 文件恢复正确的下一个 id(支持重连续传)。"""
    journal.append("delta", {"text": "a"})  # id=1
    journal.append("delta", {"text": "b"})  # id=2

    # 模拟服务重启后重建 journal 实例
    journal2 = EventJournal(job_id=journal.job_id, journal_dir=journal.journal_dir)
    next_id = journal2.append("delta", {"text": "c"})
    assert next_id == 3  # 从已有最大 id + 1 继续
