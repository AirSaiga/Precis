"""@fileoverview SSE 响应封装

把 EventJournal 的事件序列转换为 SSE (Server-Sent Events) 帧流。
支持断线续传(Last-Event-ID)和已完成任务的完整回放。

SSE 帧格式:
    id: 5
    event: delta
    data: {"text": "你好"}

(空行分隔帧)

设计要点:
- 续传: 先从 journal 读取 id > last_event_id 的事件快速回放,再切到实时推送
- 终止: 遇到终止事件(completed/error/cancelled)后自动结束流
- 心跳: 每隔一段时间发 :keep-alive 注释行,防止代理超时断开
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from .event_journal import EventJournal

logger = logging.getLogger(__name__)

# 默认实时等待超时(秒):无新事件时的心跳间隔
DEFAULT_LIVE_TIMEOUT = 15.0


def format_sse_event(
    event_id: int | None,
    event: str | None,
    data: dict[str, Any] | None,
    heartbeat: bool = False,
) -> str:
    """
    @methoddesc 格式化一个 SSE 帧

    参数:
        event_id: 事件 id,None 则不输出 id 行
        event: 事件类型,None 则不输出 event 行(默认 message)
        data: 事件数据(将被 JSON 序列化),None 则不输出 data 行
        heartbeat: True 时返回心跳注释行(:keep-alive),忽略其他参数

    返回:
        SSE 帧字符串(以 \\n\\n 结尾)
    """
    if heartbeat:
        return ":keep-alive\n\n"

    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    if event is not None:
        lines.append(f"event: {event}")
    if data is not None:
        lines.append(f"data: {json.dumps(data, ensure_ascii=False)}")
    return "\n".join(lines) + "\n\n"


async def sse_event_stream(
    journal: EventJournal,
    last_event_id: int,
    live_timeout: float = DEFAULT_LIVE_TIMEOUT,
    event_queue: asyncio.Queue[dict[str, Any]] | None = None,
) -> AsyncIterator[str]:
    """
    @methoddesc 生成 SSE 事件流

    流程:
    1. 从 journal 回放 id > last_event_id 的已有事件(快速,无延时)
    2. 若回放的最后一条已是终止事件,直接结束(任务已完成的重连场景)
    3. 否则切到实时模式: 从 event_queue 等待新事件,超时发心跳
    4. 收到终止事件后结束

    参数:
        journal: 事件日志
        last_event_id: 客户端最后收到的事件 id(0 表示从头)
        live_timeout: 实时模式心跳间隔(秒)
        event_queue: 实时事件队列,None 时只回放不实时(适合已完成任务)

    返回:
        AsyncIterator[str]: SSE 帧字符串
    """
    # 阶段 1: 回放 journal 中已有事件(从 last_event_id+1 开始)
    replayed = journal.read_since(last_event_id)
    terminated = False
    for eid, event, data in replayed:
        yield format_sse_event(event_id=eid, event=event, data=data)

    # 阶段 2: 若回放的最后一条是终止事件,任务已结束,直接关闭流
    from .types import TERMINAL_EVENTS

    if replayed and replayed[-1][1] in TERMINAL_EVENTS:
        return

    # 若 journal 整体已终止(但 replayed 为空,即 last_event_id 已是最新),也关闭
    if journal.is_terminated() and not replayed:
        return

    # 阶段 3: 实时模式(需要 event_queue)
    if event_queue is None:
        # 无队列(纯回放模式),若未终止则等待 journal 出现终止事件(轮询)
        # 这种情况通常用于测试或已完成任务的重连
        return

    while not terminated:
        try:
            entry = await asyncio.wait_for(event_queue.get(), timeout=live_timeout)
        except TimeoutError:
            # 心跳: 防止代理超时
            yield format_sse_event(event_id=None, event=None, data=None, heartbeat=True)
            continue

        eid = entry.get("id")
        event = entry.get("event")
        data = entry.get("data")
        yield format_sse_event(event_id=eid, event=event, data=data)
        if event in TERMINAL_EVENTS:
            terminated = True
