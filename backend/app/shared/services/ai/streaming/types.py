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

# 非终止事件类型：流式画布生长（Agent 模式）
# apply_actions 落盘后，逐条 emit 单条 frontend_instruction，
# 前端收到即立即执行 processFrontendInstructions + fitView，实现画布实时生长。
# completed 事件仍携带全量 instructions 作为兜底。
EVENT_FRONTEND_INSTRUCTION = "frontend_instruction"  # 单条前端指令已落盘

# 非终止事件类型：apply_actions 两阶段确认
EVENT_APPLY_PENDING = "apply_pending"  # dry-run diff 已就绪，等待用户确认
EVENT_APPLY_CONFIRMED = "apply_confirmed"  # 用户确认，已落盘
EVENT_APPLY_REJECTED = "apply_rejected"  # 用户拒绝，未落盘

# 终止事件类型（发出后关闭 SSE 连接）
EVENT_COMPLETED = "completed"  # 成功完成（含完整快照）
EVENT_ERROR = "error"  # 失败
EVENT_CANCELLED = "cancelled"  # 软取消确认

# 终止事件集合：用于 is_terminated 判定
# 注意: apply_pending/confirmed/rejected 是非终止事件，不加入此集合
TERMINAL_EVENTS: frozenset[str] = frozenset({EVENT_COMPLETED, EVENT_ERROR, EVENT_CANCELLED})

__all__ = [
    "EVENT_STARTED",
    "EVENT_PROGRESS",
    "EVENT_TURN_START",
    "EVENT_DELTA",
    "EVENT_TOOL_CALL",
    "EVENT_TOOL_RESULT",
    "EVENT_FRONTEND_INSTRUCTION",
    "EVENT_APPLY_PENDING",
    "EVENT_APPLY_CONFIRMED",
    "EVENT_APPLY_REJECTED",
    "EVENT_COMPLETED",
    "EVENT_ERROR",
    "EVENT_CANCELLED",
    "TERMINAL_EVENTS",
]
