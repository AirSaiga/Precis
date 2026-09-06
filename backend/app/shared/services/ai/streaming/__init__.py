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
"""@fileoverview AI 流式内核模块

聚合导出流式事件层：EventJournal（持久化续传）、事件类型常量。
StreamingOrchestrator（包装 service 为事件流）与 SSE 响应封装在后续 task 添加。
"""

from .event_journal import EventJournal
from .orchestrator import StreamingOrchestrator
from .sse_response import format_sse_event, sse_event_stream
from .types import (
    EVENT_APPLY_CONFIRMED,
    EVENT_APPLY_PENDING,
    EVENT_APPLY_REJECTED,
    EVENT_CANCELLED,
    EVENT_COMPLETED,
    EVENT_DELTA,
    EVENT_ERROR,
    EVENT_FRONTEND_INSTRUCTION,
    EVENT_PROGRESS,
    EVENT_STARTED,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
    EVENT_TURN_START,
    EVENT_USER_INPUT_REQUESTED,
    EVENT_USER_RESPONDED,
    TERMINAL_EVENTS,
)

__all__ = [
    "EventJournal",
    "StreamingOrchestrator",
    "format_sse_event",
    "sse_event_stream",
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
    "EVENT_USER_INPUT_REQUESTED",
    "EVENT_USER_RESPONDED",
    "TERMINAL_EVENTS",
]
