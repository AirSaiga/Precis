"""@fileoverview AI 流式内核模块

聚合导出流式事件层：EventJournal（持久化续传）、事件类型常量。
StreamingOrchestrator（包装 service 为事件流）与 SSE 响应封装在后续 task 添加。
"""

from .event_journal import EventJournal
from .types import (
    EVENT_CANCELLED,
    EVENT_COMPLETED,
    EVENT_DELTA,
    EVENT_ERROR,
    EVENT_PROGRESS,
    EVENT_STARTED,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
    EVENT_TURN_START,
    TERMINAL_EVENTS,
)

__all__ = [
    "EventJournal",
    "EVENT_STARTED",
    "EVENT_PROGRESS",
    "EVENT_TURN_START",
    "EVENT_DELTA",
    "EVENT_TOOL_CALL",
    "EVENT_TOOL_RESULT",
    "EVENT_COMPLETED",
    "EVENT_ERROR",
    "EVENT_CANCELLED",
    "TERMINAL_EVENTS",
]
