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
from app.shared.services.ai.streaming.pending_apply_store import get_global_pending_store
from app.shared.services.ai.streaming.sse_response import sse_event_stream
from app.shared.services.llm.config import loader
from app.shared.services.llm.providers.registry import create

from .models import AiChatConfirmRequest, AiChatRequest
from .router import router

logger = logging.getLogger(__name__)

# 内存中保存运行中 job 的取消信号: job_id → asyncio.Event
# orchestrator 结束后通过 _unregister_cancel_event 移除,防止内存泄漏
_cancel_events: dict[str, asyncio.Event] = {}
_cancel_events_lock = threading.Lock()

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
    journal_dir = _journal_dir_for(x_project_config_path)
    journal = EventJournal(job_id=job_id, journal_dir=journal_dir)

    cancel_event = asyncio.Event()
    with _cancel_events_lock:
        _cancel_events[job_id] = cancel_event

    # 上下文节点与历史转换(与 /chat 端点一致)
    context_nodes = [node.model_dump() for node in request.context.selectedNodes]
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
                project_path=x_project_config_path or "",
                context_nodes=context_nodes,
            )
        finally:
            _unregister_cancel_event(job_id)

    # 启动后台 task(不 await,与 SSE 响应并发)
    asyncio.create_task(_run_orchestrator())

    # 返回 SSE 流: 先回放 journal(续传), 再实时推送队列
    async def _sse_generator():
        async for frame in sse_event_stream(
            journal=journal,
            last_event_id=last_event_id,
            event_queue=event_queue,
        ):
            yield frame

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
        # 同步 resolve 挂起的 apply 确认为 reject（取消 = 拒绝）
        pending_store = get_global_pending_store()
        controller = pending_store.get(job_id)
        if controller is not None and not controller.is_resolved:
            controller.resolve("reject")
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
    pending_store = get_global_pending_store()
    controller = pending_store.get(job_id)
    if controller is None:
        raise HTTPException(404, detail="无挂起的改动(可能已决策或任务已结束)")
    if controller.is_resolved:
        return {"status": "already_resolved", "decision": controller.decision or "unknown"}
    controller.resolve(request.decision)
    return {"status": "resolved", "decision": request.decision}
