"""@fileoverview AI 流式 SSE 端点

把后端流式内核(StreamingOrchestrator + EventJournal + sse_event_stream)
暴露为 HTTP SSE 端点。

端点:
- POST /ai/chat/stream: 聊天流式,包装 ChatAgentRunner
- POST /ai/jobs/{job_id}/cancel: 取消正在运行的 job(软取消)

设计要点:
- 每个流式请求: 创建 job_id → 启动 orchestrator 后台 task → 返回 SSE StreamingResponse
- 取消信号: 内存中 _cancel_events 字典(job_id → asyncio.Event)
- 续传: 通过 Last-Event-ID header,支持断线重连
- 资源清理: orchestrator 结束后注销 cancel_event,防止内存泄漏
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from typing import Any

from fastapi import Header, HTTPException
from fastapi.responses import StreamingResponse

from app.shared.services.ai.streaming.event_journal import EventJournal
from app.shared.services.ai.streaming.orchestrator import StreamingOrchestrator
from app.shared.services.ai.streaming.pending_interaction_store import (
    ConfirmController,
    InteractionController,
    get_global_pending_interaction_store,
)
from app.shared.services.ai.streaming.sse_response import sse_event_stream
from app.shared.services.llm.config import loader
from app.shared.services.llm.providers.registry import create

from .models import AiChatConfirmRequest, AiChatRequest, AiChatRespondRequest
from .router import router

logger = logging.getLogger(__name__)

# 内存中保存运行中 job 的取消信号: job_id → asyncio.Event
# orchestrator 结束后通过 _unregister_cancel_event 移除,防止内存泄漏
_cancel_events: dict[str, asyncio.Event] = {}
_cancel_events_lock = threading.Lock()

# 后台 orchestrator task 的强引用集合：防止 task 被 GC 回收（Python asyncio 已知行为）
# task 完成后通过 add_done_callback 自动从集合移除
_background_tasks: set[asyncio.Task[None]] = set()

# journal 存储目录基础(按项目 config_path 分片),复用 AgentJobStorage 的 .precis 约定
# 实际路径在端点中按 project_path 拼接


def _unregister_cancel_event(job_id: str) -> None:
    """@methoddesc 从 _cancel_events 移除已完成 job 的取消信号(防内存泄漏)。"""
    with _cancel_events_lock:
        _cancel_events.pop(job_id, None)


def _journal_dir_for(project_path: str | None) -> str:
    """@methoddesc 根据项目路径返回 journal 目录(复用项目本地 .precis 约定)。

    无 project_path 时回退到用户级 ~/.precis。
    """
    import os

    if project_path:
        return os.path.join(project_path, ".precis", "stream_jobs")
    return os.path.join(os.path.expanduser("~"), ".precis", "stream_jobs")


@router.post("/chat/stream", summary="AI 聊天流式接口(SSE)")
async def chat_stream(
    request: AiChatRequest,
    x_project_config_path: str | None = Header(None),
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
) -> StreamingResponse:
    """@methoddesc 聊天流式端点

    流程:
    1. 加载 Provider 配置并实例化
    2. 创建 job_id、EventJournal、cancel_event、event_queue
    3. 启动后台 orchestrator task(并发执行 run_chat)
    4. 返回 SSE StreamingResponse,从 journal 续传 + 实时推送队列

    参数:
        request: AiChatRequest(复用现有聊天请求模型)
        x_project_config_path: 项目配置路径 header
        last_event_id: 续传用的 Last-Event-ID header(断线重连)

    返回:
        StreamingResponse(media_type=text/event-stream)
    """
    config = loader.load()

    # 校验项目路径（修复 #10：防止 X-Project-Config-Path 任意目录读写）
    from .utils import validate_project_path

    safe_project_path = validate_project_path(x_project_config_path)

    # 获取默认 provider(与 /chat 端点逻辑一致)
    provider_id = config.defaults.get("chat")
    if not provider_id:
        raise HTTPException(400, detail="No default provider configured")

    provider_cfg = next((p for p in config.providers if p.id == provider_id), None)
    if not provider_cfg:
        raise HTTPException(404, detail=f"Provider not found: {provider_id}")

    # 实例化 provider
    try:
        provider = create(provider_cfg)
    except ImportError as e:
        raise HTTPException(502, detail=f"Provider 实例化失败: {e}") from e

    # 创建 job 资源
    job_id = f"stream_{uuid.uuid4().hex[:12]}"
    journal_dir = _journal_dir_for(safe_project_path)
    journal = EventJournal(job_id=job_id, journal_dir=journal_dir)

    cancel_event = asyncio.Event()
    with _cancel_events_lock:
        _cancel_events[job_id] = cancel_event

    # 上下文节点与历史转换(与 /chat 端点一致)
    context_nodes = [node.model_dump() for node in request.context.selectedNodes]
    # 画布节点快照（供 read_canvas 工具查询画布真实状态）
    canvas_nodes = [node.model_dump() for node in request.context.canvasNodes]
    history = [{"role": h.role, "content": h.content} for h in (request.history or [])]

    # 实时事件队列: orchestrator emit 时推入, sse_event_stream 消费
    event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    orchestrator = StreamingOrchestrator(
        job_id=job_id,
        journal=journal,
        cancel_event=cancel_event,
        event_queue=event_queue,
    )

    async def _run_orchestrator() -> None:
        """后台执行 run_chat,结束后注销 cancel_event。"""
        try:
            await orchestrator.run_chat(
                message=request.message,
                history=history,
                provider=provider,
                project_path=safe_project_path,
                context_nodes=context_nodes,
                canvas_nodes=canvas_nodes,
            )
        finally:
            _unregister_cancel_event(job_id)

    # 启动后台 task：持有强引用防 GC，完成回调中移除
    task = asyncio.create_task(_run_orchestrator())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    # 返回 SSE 流: 先回放 journal(续传), 再实时推送队列
    async def _sse_generator():
        try:
            async for frame in sse_event_stream(
                journal=journal,
                last_event_id=last_event_id,
                event_queue=event_queue,
            ):
                yield frame
        finally:
            # 客户端断连时（StreamingResponse 被取消），通知后台 task 停止
            # 这让 executor 在下一个取消检查点中断，避免后台 task 泄漏
            cancel_event.set()

    return StreamingResponse(_sse_generator(), media_type="text/event-stream")


@router.post("/jobs/{job_id}/cancel", summary="取消正在运行的 AI job(软取消)")
async def cancel_job(job_id: str) -> dict[str, str]:
    """@methoddesc 取消端点(软取消)

    设置 cancel_event 后,orchestrator/executor 在下一个检查点(turn 开始/chunk 间)中断。
    已落盘的 apply_actions 改动保留,前端轨迹如实显示已执行步数。
    同步 resolve 挂起的 apply_actions 确认门为 reject。

    参数:
        job_id: 任务 ID

    返回:
        {"status": "cancelling"} 或 {"status": "not_found"}
    """
    with _cancel_events_lock:
        ev = _cancel_events.get(job_id)
    if ev is not None:
        ev.set()
        # 同步 resolve 该 job 下所有挂起的交互门（apply→reject, ask→skipped）。
        # store 同时持有两类 controller，resolve 签名不同，按 isinstance 分别处理。
        pending_store = get_global_pending_interaction_store()
        for controller in pending_store.pop_by_job_prefix(job_id):
            if not controller.is_resolved:
                if isinstance(controller, ConfirmController):
                    await controller.resolve("reject")
                elif isinstance(controller, InteractionController):
                    await controller.resolve({"skipped": True, "reason": "cancelled"})
        return {"status": "cancelling"}
    return {"status": "not_found"}


@router.post("/chat/{job_id}/confirm", summary="确认/拒绝挂起的 apply_actions 改动")
async def confirm_apply(job_id: str, request: AiChatConfirmRequest) -> dict[str, str]:
    """@methoddesc 确认端点

    用户在前端点击"确认"或"拒绝"后调用。
    decide 后 resolve ConfirmController 唤醒挂起的 apply_actions 协程。

    参数:
        job_id: 任务 ID
        request: 含 decision 字段("confirm" 或 "reject")

    返回:
        {"status": "resolved", "decision": "confirm"} 或 404
    """
    pending_store = get_global_pending_interaction_store()
    # 优先用 apply_id 精确查找；为空时回退到 job 维度（兼容单 apply 场景）
    lookup_key = request.apply_id if request.apply_id else job_id
    controller = pending_store.get(lookup_key)
    if controller is None:
        raise HTTPException(404, detail="无挂起的改动(可能已决策或任务已结束)")
    # /confirm 只处理 apply 确认（ConfirmController）；若拿到 InteractionController 说明 key 冲突，拒绝
    if not isinstance(controller, ConfirmController):
        raise HTTPException(409, detail="该交互不是 apply 确认类型，无法用 /confirm 处理")
    if controller.is_resolved:
        return {"status": "already_resolved", "decision": controller.decision or "unknown"}
    await controller.resolve(request.decision)
    return {"status": "resolved", "decision": request.decision}


@router.post("/chat/{job_id}/respond", summary="回答 agent 的 ask_user 提问")
async def respond_to_ask(job_id: str, request: AiChatRespondRequest) -> dict[str, Any]:
    """@methoddesc 回答端点

    用户在前端 AskUserCard 提交回答后调用。
    resolve InteractionController 唤醒挂起的 ask_user 协程。

    参数:
        job_id: 任务 ID
        request: 含 ask_id 和 response 字段

    返回:
        {"ok": true, "already_resolved": false} 或 404（ask_id 不存在）/ 409（类型不符）
    """
    pending_store = get_global_pending_interaction_store()
    controller = pending_store.get(request.ask_id)
    if controller is None:
        raise HTTPException(404, detail="提问已过期或不存在(可能已回答或任务已结束)")
    # /respond 只处理 ask 交互（InteractionController）；若拿到 ConfirmController 说明 key 冲突，拒绝
    if not isinstance(controller, InteractionController):
        raise HTTPException(409, detail="该交互不是 ask 提问类型，无法用 /respond 处理")
    if controller.is_resolved:
        return {"ok": True, "already_resolved": True}
    await controller.resolve(request.response)
    return {"ok": True, "already_resolved": False}
