"""@fileoverview 流式事件类型与常量

定义统一的 SSE 事件类型常量与终止事件集合。
三个场景(chat/generate/migrate)共享同一套事件类型。
"""

from __future__ import annotations

# 非终止事件类型
EVENT_STARTED = "started"  # 任务启动，携带 job_id/kind
EVENT_PROGRESS = "progress"  # 阶段进度（画像/分块/合并等），仅 generate/migrate
EVENT_TURN_START = "turn_start"  # Agent 新一轮开始
EVENT_DELTA = "delta"  # 流式文本块（增量，前端累积）
EVENT_TOOL_CALL = "tool_call"  # 工具调用开始
EVENT_TOOL_RESULT = "tool_result"  # 工具执行完成

# 终止事件类型（发出后关闭 SSE 连接）
EVENT_COMPLETED = "completed"  # 成功完成（含完整快照）
EVENT_ERROR = "error"  # 失败
EVENT_CANCELLED = "cancelled"  # 软取消确认

# 终止事件集合：用于 is_terminated 判定
TERMINAL_EVENTS: frozenset[str] = frozenset({EVENT_COMPLETED, EVENT_ERROR, EVENT_CANCELLED})

__all__ = [
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
