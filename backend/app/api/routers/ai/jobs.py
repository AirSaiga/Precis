"""@fileoverview AI 异步配置生成任务 API 路由模块

功能概述:
- 创建异步配置生成任务，避免大文件场景阻塞请求
- 查询任务执行状态和进度
- 支持取消正在运行的任务
- 项目本地持久化任务状态（支持后端重启后恢复）

架构设计:
- 使用 asyncio.create_task 在后台执行生成任务
- 通过 AgentJobStorage 持久化任务状态和 checkpoint
- 通过内存字典 _job_tasks 保存运行中的 Task 句柄
- 支持进度回调，实时更新任务阶段和进度百分比
- 超过最大任务数时自动清理已完成任务
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, Header, HTTPException

from app.api.dependencies import get_project_config_path
from app.shared.services.ai.job_storage import AgentJobStorage
from app.shared.services.llm.generation import (
    CancelledError,
    ConfigGenerationService,
    GenerationOptions,
    GenerationParseError,
    ProfilingOptions,
)

from .models import ConfigGenerateJobCreateResponse, ConfigGenerateJobStatus, ConfigGenerateRequest
from .router import router

logger = logging.getLogger(__name__)

# 内存中的任务句柄（仅用于取消运行中的任务）
_job_tasks: dict[str, asyncio.Task] = {}
_job_tasks_lock = threading.Lock()

# 持久化 job 状态清理参数
_JOB_TTL_HOURS = 24.0


def _get_storage(config_path: str) -> AgentJobStorage:
    """获取指定项目的持久化存储实例。"""
    return AgentJobStorage(config_path)


def _serialize_result(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """将生成结果序列化为可 JSON 序列化的字典。"""
    if result is None:
        return None
    # 只保留必要字段，避免循环引用或不可序列化对象
    return {
        "success": result.get("success", False),
        "yaml_preview": result.get("yaml_preview", ""),
        "manifest": result.get("manifest"),
        "schemas": result.get("schemas", {}),
        "constraints": result.get("constraints", {}),
        "regex_nodes": result.get("regex_nodes", {}),
        "warnings": result.get("warnings", []),
        "error": result.get("error"),
    }


def _now_iso() -> str:
    """返回当前 UTC 时间 ISO 字符串。"""
    return datetime.now(UTC).isoformat()


@router.post(
    "/config/generate/jobs",
    response_model=ConfigGenerateJobCreateResponse,
    summary="创建异步配置生成任务",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
async def create_generate_job(
    payload: ConfigGenerateRequest,
    config_path: str = Depends(get_project_config_path),
) -> ConfigGenerateJobCreateResponse:
    """
    创建异步配置生成任务

    适用于大文件或批量生成场景，避免阻塞请求
    """
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    now = _now_iso()

    storage = _get_storage(config_path)
    storage.cleanup_old_jobs(max_age_hours=_JOB_TTL_HOURS)

    job_status = ConfigGenerateJobStatus(
        job_id=job_id,
        status="pending",
        stage="initializing",
        progress=0.0,
        iterations=0,
        max_iterations=payload.options.max_iterations,
        created_at=now,
        updated_at=now,
        warnings=[],
    )
    storage.save_status(job_id, job_status.model_dump())

    # 在后台运行任务（保存 Task 句柄以便取消）
    task = asyncio.create_task(_run_job(job_id, payload, config_path))
    with _job_tasks_lock:
        _job_tasks[job_id] = task

    return ConfigGenerateJobCreateResponse(job_id=job_id)


async def _run_job(
    job_id: str,
    payload: ConfigGenerateRequest,
    config_path: str,
    emit: Callable[[str, dict[str, Any]], None] | None = None,
    initial_checkpoint: dict[str, Any] | None = None,
):
    """后台执行任务

    参数:
        emit: 可选的 SSE 事件推送回调 (event_type, data_dict)。
            传入时，update_status/终态会同时推 SSE 事件；不传则只持久化（兼容现有轮询）。
    """

    def emit_status(event_type: str, **fields: Any) -> None:
        """持久化状态变更的同时推 SSE 事件（若 emit 已注入）。"""
        if emit is not None:
            emit(event_type, {k: v for k, v in fields.items() if v is not None})

    storage = _get_storage(config_path)

    def update_status(
        status: str,
        stage: str | None = None,
        progress: float | None = None,
        message: str | None = None,
        iterations: int | None = None,
        metrics: dict[str, Any] | None = None,
        current_plan: list[dict[str, Any]] | None = None,
        warnings: list[str] | None = None,
        error: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> ConfigGenerateJobStatus:
        """更新并持久化任务状态。"""
        existing = storage.load_status(job_id) or {}
        data = {
            "job_id": job_id,
            "status": status,
            "stage": stage if stage is not None else existing.get("stage", "initializing"),
            "message": message if message is not None else existing.get("message"),
            "progress": progress if progress is not None else existing.get("progress"),
            "iterations": iterations if iterations is not None else existing.get("iterations", 0),
            "max_iterations": payload.options.max_iterations,
            "metrics": metrics if metrics is not None else existing.get("metrics"),
            "current_plan": current_plan if current_plan is not None else existing.get("current_plan"),
            "created_at": existing.get("created_at", _now_iso()),
            "updated_at": _now_iso(),
            "warnings": warnings if warnings is not None else existing.get("warnings", []),
            "error": error if error is not None else existing.get("error"),
        }
        if result is not None:
            data["result"] = result
        job_status = ConfigGenerateJobStatus(**data)
        storage.save_status(job_id, job_status.model_dump())

        # 同时推 SSE 事件（若 emit 已注入）
        # 终态用对应事件类型，中间态用 progress 事件
        if status == "completed":
            emit_status("completed", reply="", result=data.get("result"), iterations=iterations)
        elif status == "failed":
            emit_status("error", message=error or "生成失败")
        elif status == "cancelled":
            emit_status("cancelled", completed_turns=iterations or 0, partial=True)
        else:
            # running 中间态
            emit_status(
                "progress",
                stage=stage,
                progress=progress,
                message=message,
                iterations=iterations,
                metrics=metrics,
                current_plan=current_plan,
            )
        return job_status

    update_status("running", stage="initializing", progress=0.0)

    # 存储 payload 元数据供 resume 重建
    # B18 修复：保存全部 options（过去仅保存 max_iterations，resume 时其余 options 回退默认值）
    raw = storage._load_raw(job_id)
    raw["payload"] = {
        "file_paths": payload.file_paths,
        "project_name": payload.project_name,
        "project_id": payload.project_id,
        "provider_id": payload.provider_id,
        "max_iterations": payload.options.max_iterations,
        # 完整保存 options 字典，resume 时整体重建
        "options": payload.options.model_dump(),
    }
    storage._save_raw(job_id, raw)

    service = ConfigGenerationService(provider_id=payload.provider_id)

    profiling_opts = ProfilingOptions(
        sample_rows=payload.options.sample_rows,
        sample_values_per_column=payload.options.sample_values_per_column,
        max_files=payload.options.max_files,
        max_cell_chars=payload.options.max_cell_chars,
    )

    gen_opts = GenerationOptions(
        generate_schemas=payload.options.generate_schemas,
        generate_constraints=payload.options.generate_constraints,
        generate_regex_nodes=payload.options.generate_regex_nodes,
        keep_existing=payload.options.keep_existing,
    )

    def progress_callback(stage: str, progress: float, extra: dict[str, Any] | None = None):
        """
        @methoddesc 同步进度回调，更新任务状态

        业务用途:
        - 由 ConfigGenerationService 在生成过程中周期性调用
        - 同时检查任务是否被取消，若是则调用 service.cancel() 触发中止

        参数:
            stage: 当前阶段名称（如 "profiling" / "generating"）
            progress: 当前进度（0.0 - 1.0）
            extra: 附加信息（如迭代轮数、metrics）
        """
        # 检查是否被取消
        current_status = storage.load_status(job_id)
        if current_status and current_status.get("status") == "cancelled":
            service.cancel()

        extra = extra or {}
        update_status(
            "running",
            stage=stage,
            progress=min(progress * 100.0, 100.0),
            iterations=extra.get("iterations"),
            metrics=extra.get("metrics"),
            current_plan=extra.get("current_plan"),
        )

    def on_checkpoint(cp: dict[str, Any]) -> None:
        """checkpoint 落盘回调，异常不中断任务。"""
        try:
            storage.save_checkpoint(job_id, cp)
        except Exception:
            logger.warning("checkpoint 落盘失败", exc_info=True)

    try:
        from .models import ConfigGenerateResponse

        if payload.options.agent_mode:
            result = await service.generate_with_agent(
                file_paths=payload.file_paths,
                project_name=payload.project_name,
                project_id=payload.project_id,
                config_path=config_path,
                profiling_options=profiling_opts,
                generation_options=gen_opts,
                max_iterations=payload.options.max_iterations,
                validation_sample_size=payload.options.validation_sample_size,
                auto_chunking=payload.options.auto_chunking,
                chunk_max_columns=payload.options.chunk_max_columns,
                chunk_max_files=payload.options.chunk_max_files,
                progress_callback=progress_callback,
                checkpoint_callback=on_checkpoint,
                initial_checkpoint=initial_checkpoint,
            )
        else:
            result = await service.generate(
                file_paths=payload.file_paths,
                project_name=payload.project_name,
                project_id=payload.project_id,
                config_path=config_path,
                profiling_options=profiling_opts,
                generation_options=gen_opts,
                progress_callback=progress_callback,
            )

        response_result = ConfigGenerateResponse(
            success=result["success"],
            yaml_preview=result["yaml_preview"],
            manifest=result["manifest"],
            schemas=result["schemas"],
            constraints=result["constraints"],
            regex_nodes=result["regex_nodes"],
            warnings=result.get("warnings", []),
            error=result.get("error"),
        )

        # B17 修复：按 result["success"] 区分 completed/failed，
        # 过去无论成功失败都标记 completed，导致失败任务在前端显示为成功
        final_status = "completed" if result.get("success") else "failed"
        update_status(
            final_status,
            stage=final_status,
            progress=100.0,
            iterations=result.get("iterations"),
            metrics=result.get("metrics"),
            warnings=result.get("warnings", []),
            result=response_result.model_dump(),
            error=result.get("error") if not result.get("success") else None,
        )

    except CancelledError:
        update_status(
            "cancelled",
            stage="cancelled",
            progress=0.0,
            error="任务已取消",
        )
    except GenerationParseError as e:
        update_status(
            "failed",
            stage="error",
            error=f"配置解析失败: {e}",
        )
    except Exception as e:
        update_status(
            "failed",
            stage="error",
            error=str(e),
        )
    finally:
        with _job_tasks_lock:
            _job_tasks.pop(job_id, None)


@router.get(
    "/config/generate/jobs/{job_id}",
    response_model=ConfigGenerateJobStatus,
    summary="获取任务状态",
    responses={
        404: {"description": "任务未找到"},
    },
)
async def get_generate_job(job_id: str, config_path: str = Depends(get_project_config_path)) -> ConfigGenerateJobStatus:
    """获取任务状态"""
    storage = _get_storage(config_path)
    status_data = storage.load_status(job_id)
    if not status_data:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return ConfigGenerateJobStatus(**status_data)


@router.post(
    "/config/generate/stream",
    summary="AI 配置生成流式接口(SSE)",
)
async def generate_stream(
    payload: ConfigGenerateRequest,
    config_path: str = Depends(get_project_config_path),
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
):
    """@methoddesc 配置生成流式端点

    创建 generate job task 并通过 SSE 实时推送进度与终态。
    复用 _run_job 逻辑，通过 emit 回调桥接到 EventJournal + 事件队列。
    支持断线重连续传（Last-Event-ID）。
    """
    from fastapi.responses import StreamingResponse

    from app.shared.services.ai.streaming.event_journal import EventJournal
    from app.shared.services.ai.streaming.sse_response import sse_event_stream

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    now = _now_iso()

    storage = _get_storage(config_path)
    storage.cleanup_old_jobs(max_age_hours=_JOB_TTL_HOURS)
    job_status = ConfigGenerateJobStatus(
        job_id=job_id,
        status="pending",
        stage="initializing",
        progress=0.0,
        iterations=0,
        max_iterations=payload.options.max_iterations,
        created_at=now,
        updated_at=now,
        warnings=[],
    )
    storage.save_status(job_id, job_status.model_dump())

    # 创建 EventJournal + 事件队列
    journal_dir = _journal_dir_for(config_path)
    journal = EventJournal(job_id=job_id, journal_dir=journal_dir)
    event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    # emit 回调：把状态变更追加到 journal + 推事件队列
    def emit(event: str, data: dict[str, Any]) -> None:
        eid = journal.append(event, data)
        try:
            event_queue.put_nowait({"id": eid, "event": event, "data": data})
        except asyncio.QueueFull:
            pass

    # 后台执行 job task，注入 emit
    task = asyncio.create_task(_run_job(job_id, payload, config_path, emit=emit))
    with _job_tasks_lock:
        _job_tasks[job_id] = task

    async def _sse_generator():
        async for frame in sse_event_stream(
            journal=journal,
            last_event_id=last_event_id,
            event_queue=event_queue,
        ):
            yield frame

    return StreamingResponse(_sse_generator(), media_type="text/event-stream")


def _journal_dir_for(config_path: str) -> str:
    """根据项目路径返回 journal 目录（复用 .precis/stream_jobs 约定）。"""
    import os

    if config_path:
        return os.path.join(config_path, ".precis", "stream_jobs")
    return os.path.join(os.path.expanduser("~"), ".precis", "stream_jobs")


@router.post(
    "/config/generate/jobs/{job_id}/cancel",
    response_model=ConfigGenerateJobStatus,
    summary="取消任务",
    responses={
        404: {"description": "任务未找到"},
    },
)
async def cancel_generate_job(
    job_id: str, config_path: str = Depends(get_project_config_path)
) -> ConfigGenerateJobStatus:
    """取消任务"""
    storage = _get_storage(config_path)
    status_data = storage.load_status(job_id)
    if not status_data:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    if status_data.get("status") in ("completed", "failed", "cancelled"):
        return ConfigGenerateJobStatus(**status_data)

    status_data["status"] = "cancelled"
    status_data["stage"] = "cancelled"
    status_data["updated_at"] = _now_iso()
    storage.save_status(job_id, status_data)

    # 真正取消运行中的任务
    with _job_tasks_lock:
        task = _job_tasks.get(job_id)
        if task and not task.done():
            task.cancel()

    return ConfigGenerateJobStatus(**status_data)


@router.post(
    "/config/generate/jobs/{job_id}/resume",
    summary="从最近 checkpoint 续跑任务",
    responses={
        404: {"description": "无可用 checkpoint"},
    },
)
async def resume_job(
    job_id: str,
    config_path: str = Depends(get_project_config_path),
) -> dict[str, Any]:
    """从最近 checkpoint 续跑任务

    加载最新的 checkpoint 并在后台重启 executor.run(initial_checkpoint=cp)。
    """
    storage = _get_storage(config_path)
    cp = storage.load_latest_checkpoint(job_id)
    if not cp:
        raise HTTPException(status_code=404, detail="无可用 checkpoint")

    status_data = storage.load_status(job_id)
    if not status_data:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    # 从持久化的 payload 元数据重建请求
    raw = storage.load_full(job_id)
    meta = raw.get("payload", {})
    from .models import ConfigGenerateOptions

    # B18 修复：优先使用完整保存的 options 字典重建，回退到仅 max_iterations（兼容旧数据）
    saved_options = meta.get("options")
    if isinstance(saved_options, dict):
        options = ConfigGenerateOptions(**saved_options)
    else:
        options = ConfigGenerateOptions(max_iterations=meta.get("max_iterations", 2))

    payload = ConfigGenerateRequest(
        file_paths=meta.get("file_paths", []),
        project_name=meta.get("project_name", ""),
        project_id=meta.get("project_id", ""),
        provider_id=meta.get("provider_id"),
        options=options,
    )

    # 更新状态为 resuming
    status_data["status"] = "running"
    status_data["stage"] = "resuming"
    status_data["updated_at"] = _now_iso()
    storage.save_status(job_id, status_data)

    # 后台重启任务
    task = asyncio.create_task(_run_job(job_id, payload, config_path, initial_checkpoint=cp))
    with _job_tasks_lock:
        _job_tasks[job_id] = task

    return {"status": "resuming", "turn": cp.get("turn", 0)}
