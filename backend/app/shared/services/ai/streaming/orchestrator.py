"""@fileoverview 流式编排器（StreamingOrchestrator）

把现有的 ChatAgentRunner / ConfigGenerationService / ConfigMigrationService
包装成统一的事件流（StreamEvent 序列），落盘到 EventJournal 并推给 SSE 队列。

设计原则（可维护性 + 健壮性）:
- 业务逻辑零改动: 通过回调注入桥接 service 输出，不重写 service
- emit 是唯一事件出口: 同时落盘 EventJournal（支持续传）+ 推给内存队列（实时 SSE）
- finally 注销取消信号: 无论成功/取消/失败都清理，防止内存泄漏
- 终止事件携带完整快照: 即使中途 delta 丢失，前端也能渲染完整结果
- apply_actions 两阶段确认: 创建 ConfirmController 注册 store，桥接 apply_* 事件
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.shared.services.ai.agent.chat_tools.apply_actions import ApplyCallbacks
from app.shared.services.ai.agent.types import ToolResult
from app.shared.services.ai.chat_agent_runner import ChatAgentRunner
from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    InteractionController,
    get_global_pending_interaction_store,
)

from .event_journal import EventJournal
from .types import (
    EVENT_APPLY_CONFIRMED,
    EVENT_APPLY_PENDING,
    EVENT_APPLY_REJECTED,
    EVENT_CANCELLED,
    EVENT_COMPLETED,
    EVENT_DELTA,
    EVENT_ERROR,
    EVENT_FRONTEND_INSTRUCTION,
    EVENT_STARTED,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
    EVENT_TURN_START,
)

logger = logging.getLogger(__name__)


class StreamingOrchestrator:
    """@classdesc 流式编排器

    包装底层 service 为事件流。每个实例对应一个 job_id 的完整生命周期。
    """

    def __init__(
        self,
        job_id: str,
        journal: EventJournal,
        cancel_event: asyncio.Event,
        event_queue: asyncio.Queue[dict[str, Any]] | None = None,
    ):
        """
        @methoddesc 初始化流式编排器

        参数:
            job_id: 任务 ID
            journal: 事件日志（持久化续传）
            cancel_event: 取消信号（由 cancel 端点 set）
            event_queue: 可选的实时事件队列，推送给 SSE 响应。None 时只落盘不推队列。
        """
        self.job_id = job_id
        self.journal = journal
        self.cancel_event = cancel_event
        self.event_queue = event_queue

    def emit(self, event: str, data: dict[str, Any]) -> int:
        """@methoddesc 追加一个事件到 journal（并推给队列，若有）。

        参数:
            event: 事件类型
            data: 事件数据

        返回:
            分配的事件 id
        """
        # 终止事件 + apply_pending 强制 fsync（保证关键状态持久化，delta 等高频事件不 fsync）
        from .types import TERMINAL_EVENTS

        force_fsync = event in TERMINAL_EVENTS or event == "apply_pending"
        eid = self.journal.append(event, data, force_fsync=force_fsync)
        if self.event_queue is not None:
            try:
                self.event_queue.put_nowait({"id": eid, "event": event, "data": data})
            except asyncio.QueueFull:
                logger.warning(f"事件队列已满，丢弃实时事件 {event} (job={self.job_id})")
        return eid

    def _emit_apply(self, event: str, payload: dict[str, Any]) -> None:
        """@methoddesc 桥接 apply 事件回调（丢弃 emit 返回值以匹配 Callable[..., None]）。"""
        self.emit(event, payload)

    async def run_chat(
        self,
        message: str,
        history: list[dict[str, str]] | None,
        provider: Any,
        project_path: str,
        context_nodes: list[dict[str, Any]],
        canvas_nodes: list[dict[str, Any]] | None = None,
    ) -> None:
        """@methoddesc 包装 ChatAgentRunner 为流式事件流

        流程: started → (delta/turn_start/tool_call/tool_result 经回调) → completed/cancelled/error
        新增: apply_pending → await 用户确认 → apply_confirmed/apply_rejected

        参数:
            message: 用户消息
            history: 对话历史
            provider: Provider 实例
            project_path: 项目配置目录
            context_nodes: 选中上下文节点
            canvas_nodes: 画布全部业务节点快照（供 read_canvas 工具查询）
        """
        self.emit(EVENT_STARTED, {"job_id": self.job_id, "kind": "chat"})

        # apply 的确认控制器现在由 ApplyActionsTool 每次 apply 时独立创建（按 apply_id 键控），
        # 不再在 job 级创建单一控制器（避免第 2 个 apply 复用旧决策）。

        # 创建 apply 事件桥接回调
        apply_callbacks = ApplyCallbacks(
            on_apply_pending=lambda payload: self._emit_apply(EVENT_APPLY_PENDING, payload),
            on_apply_confirmed=lambda payload: self._emit_apply(EVENT_APPLY_CONFIRMED, payload),
            on_apply_rejected=lambda payload: self._emit_apply(EVENT_APPLY_REJECTED, payload),
            on_frontend_instruction=lambda payload: self._emit_apply(EVENT_FRONTEND_INSTRUCTION, payload),
        )

        runner = ChatAgentRunner(
            provider=provider,
            project_path=project_path,
            context_nodes=context_nodes,
            apply_callbacks=apply_callbacks,
            dry_run_enabled=True,
            job_id=self.job_id,
            canvas_nodes=canvas_nodes,
        )

        # 工具 label 映射（与 ChatAgentRunner._TOOL_LABELS 一致，供 tool_call 事件使用）
        tool_labels = dict(ChatAgentRunner._TOOL_LABELS)

        # 桥接回调：把 service 输出转为事件
        def on_chunk(text: str) -> None:
            self.emit(EVENT_DELTA, {"text": text})

        def on_turn(turn: int) -> None:
            self.emit(EVENT_TURN_START, {"turn": turn})

        def on_tool_call(name: str, call_id: str, turn: int) -> None:
            label = tool_labels.get(name, name)
            self.emit(EVENT_TOOL_CALL, {"tool": name, "call_id": call_id, "turn": turn, "label": label})

        def on_tool_result(tr: ToolResult) -> None:
            self.emit(
                EVENT_TOOL_RESULT,
                {
                    "call_id": tr.call_id,
                    "name": tr.name,
                    "success": tr.success,
                    "label": tool_labels.get(tr.name, tr.name),
                    "error": tr.error,
                },
            )

        def cancelled() -> bool:
            return self.cancel_event.is_set()

        runner.configure_callbacks(
            on_chunk=on_chunk,
            on_turn=on_turn,
            on_tool_call=on_tool_call,
            on_tool_result=on_tool_result,
            cancelled=cancelled,
        )

        try:
            result = await runner.run(message, history)
        except Exception as e:
            logger.exception(f"StreamingOrchestrator run_chat 失败 (job={self.job_id})")
            self.emit(EVENT_ERROR, {"message": f"Agent 执行失败: {e}", "code": "RUNNER_ERROR"})
            return
        finally:
            # 兜底清理：拒绝该 job 下所有未决议的 apply 控制器（每次 apply 各自独立，可能有多个）
            # 注意：apply 挂起时 finally 不可达（await 未返回），由 await_decision 超时兜底
            pending_store = get_global_pending_interaction_store()
            for controller in pending_store.pop_by_job_prefix(self.job_id):
                if not controller.is_resolved:
                    # store 同时持有 apply（ConfirmController）和 ask（InteractionController），
                    # 两类 resolve 签名不同：apply 接 str（confirm/reject），ask 接 dict。
                    if isinstance(controller, ConfirmController):
                        logger.warning(
                            f"run_chat finally 兜底 resolve reject (job={self.job_id}, apply={controller.request_id})"
                        )
                        await controller.resolve("reject")
                    elif isinstance(controller, InteractionController):
                        logger.warning(
                            f"run_chat finally 兜底 resolve skip (job={self.job_id}, ask={controller.request_id})"
                        )
                        await controller.resolve({"skipped": True, "reason": "cancelled"})

        # 终态判定：用 result.cancelled 显式字段（而非 success+iterations 启发式）
        # cancel_event.is_set() 覆盖外部取消信号；result.cancelled 覆盖 executor 内部取消
        if self.cancel_event.is_set() or getattr(result, "cancelled", False):
            # 软取消：已落盘的 apply_actions 改动保留，轨迹如实显示
            self.emit(
                EVENT_CANCELLED,
                {
                    "completed_turns": getattr(result, "iterations", 0),
                    "partial": True,
                    "tool_steps": getattr(result, "tool_steps", []),
                    "reply": getattr(result, "reply", ""),
                },
            )
        elif not getattr(result, "success", True):
            # 失败（非取消）
            self.emit(
                EVENT_ERROR,
                {"message": getattr(result, "error", "未知错误"), "code": "AGENT_FAILED"},
            )
        else:
            # 成功：终止事件携带完整快照（容错兜底）
            self.emit(
                EVENT_COMPLETED,
                {
                    "reply": getattr(result, "reply", ""),
                    "frontend_instructions": getattr(result, "frontend_instructions", []),
                    "tool_steps": getattr(result, "tool_steps", []),
                    "iterations": getattr(result, "iterations", 0),
                },
            )
