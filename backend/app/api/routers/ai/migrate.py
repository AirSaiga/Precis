"""@fileoverview AI 配置迁移任务 API 路由模块

功能概述:
- 创建异步配置迁移任务（从旧脚本迁移生成 Precis 配置）
- 复用 Agent 内核和任务持久化
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
from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.generation import (
    CancelledError,
    GenerationOptions,
    GenerationParseError,
    ProfilingOptions,
)

from .models import (
    ConfigGenerateJobCreateResponse,
    ConfigGenerateJobStatus,
    ConfigGenerateResponse,
    ConfigMigrateRequest,
)
from .router import router

logger = logging.getLogger(__name__)

_job_tasks: dict[str, asyncio.Task] = {}
_job_tasks_lock = threading.Lock()
_JOB_TTL_HOURS = 24.0


def _get_storage(config_path: str) -> AgentJobStorage:
    """获取指定项目的持久化存储实例。"""
    return AgentJobStorage(config_path)


def _now_iso() -> str:
    """返回当前 UTC 时间 ISO 字符串。"""
    return datetime.now(UTC).isoformat()


@router.post(
    "/config/migrate/jobs",
    response_model=ConfigGenerateJobCreateResponse,
    summary="创建异步配置迁移任务",
)
async def create_migrate_job(
    payload: ConfigMigrateRequest,
    config_path: str = Depends(get_project_config_path),
) -> ConfigGenerateJobCreateResponse:
    """创建异步配置迁移任务"""
    job_id = f"job_migrate_{uuid.uuid4().hex[:12]}"
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

    task = asyncio.create_task(_run_migrate_job(job_id, payload, config_path))
    with _job_tasks_lock:
        _job_tasks[job_id] = task

    return ConfigGenerateJobCreateResponse(job_id=job_id)


async def _run_migrate_job(
    job_id: str,
    payload: ConfigMigrateRequest,
    config_path: str,
    emit: Callable[[str, dict[str, Any]], None] | None = None,
    initial_checkpoint: dict[str, Any] | None = None,
):
    """后台执行迁移任务

    参数:
        emit: 可选的 SSE 事件推送回调 (event_type, data_dict)。
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
        warnings: list[str] | None = None,
        error: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> ConfigGenerateJobStatus:
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
        if status == "completed":
            emit_status("completed", reply="", result=data.get("result"), iterations=iterations)
        elif status == "failed":
            emit_status("error", message=error or "迁移失败")
        elif status == "cancelled":
            emit_status("cancelled", completed_turns=iterations or 0, partial=True)
        else:
            emit_status(
                "progress",
                stage=stage,
                progress=progress,
                message=message,
                iterations=iterations,
                metrics=metrics,
            )
        return job_status

    update_status("running", stage="initializing", progress=0.0)

    # 存储 payload 元数据供 resume 重建
    raw = storage._load_raw(job_id)
    raw["payload"] = {
        "script_content": payload.script_content,
        "language": payload.language,
        "file_paths": payload.file_paths,
        "project_name": payload.project_name,
        "project_id": payload.project_id,
        "provider_id": payload.provider_id,
        "max_iterations": payload.options.max_iterations,
    }
    storage._save_raw(job_id, raw)

    service = ConfigMigrationService(provider_id=payload.provider_id)

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
        current_status = storage.load_status(job_id)
        if current_status and current_status.get("status") == "cancelled":
            service.cancel()
            return
        extra = extra or {}
        update_status(
            "running",
            stage=stage,
            progress=min(progress * 100.0, 100.0),
            iterations=extra.get("iterations"),
            metrics=extra.get("metrics"),
        )

    def on_checkpoint(cp: dict[str, Any]) -> None:
        try:
            storage.save_checkpoint(job_id, cp)
        except Exception:
            logger.warning("checkpoint 落盘失败", exc_info=True)

    try:
        result = await service.migrate_from_script(
            script_content=payload.script_content,
            language=payload.language,
            file_paths=payload.file_paths,
            project_name=payload.project_name,
            project_id=payload.project_id,
            config_path=config_path,
            profiling_options=profiling_opts,
            generation_options=gen_opts,
            max_iterations=payload.options.max_iterations,
            validation_sample_size=payload.options.validation_sample_size,
            progress_callback=progress_callback,
            checkpoint_callback=on_checkpoint,
            initial_checkpoint=initial_checkpoint,
            sources=[s.model_dump() for s in payload.sources] if payload.sources else None,
        )

        response_result = ConfigGenerateResponse(
            success=result["success"],
            yaml_preview=result.get("yaml_preview", ""),
            manifest=result.get("manifest"),
            schemas=result.get("schemas"),
            constraints=result.get("constraints"),
            regex_nodes=result.get("regex_nodes"),
            warnings=result.get("warnings", []),
            error=result.get("error"),
            iterations=result.get("iterations"),
            metrics=result.get("metrics"),
        )

        if result.get("success"):
            update_status(
                "completed",
                stage="completed",
                progress=100.0,
                iterations=result.get("iterations"),
                metrics=result.get("metrics"),
                warnings=result.get("warnings", []),
                result=response_result.model_dump(),
            )
        else:
            update_status(
                "failed",
                stage="error",
                progress=100.0,
                error=result.get("error") or "迁移失败",
                iterations=result.get("iterations"),
                metrics=result.get("metrics"),
                warnings=result.get("warnings", []),
                result=response_result.model_dump(),
            )

    except CancelledError:
        update_status("cancelled", stage="cancelled", error="任务已取消")
    except GenerationParseError as e:
        update_status("failed", stage="error", error=f"配置解析失败: {e}")
    except Exception as e:
        update_status("failed", stage="error", error=str(e))
    finally:
        with _job_tasks_lock:
            _job_tasks.pop(job_id, None)


@router.get(
    "/config/migrate/jobs/{job_id}",
    response_model=ConfigGenerateJobStatus,
    summary="获取迁移任务状态",
    responses={
        404: {"description": "任务未找到"},
    },
)
async def get_migrate_job(job_id: str, config_path: str = Depends(get_project_config_path)) -> ConfigGenerateJobStatus:
    """获取迁移任务状态"""
    storage = _get_storage(config_path)
    status_data = storage.load_status(job_id)
    if not status_data:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return ConfigGenerateJobStatus(**status_data)


@router.post(
    "/config/migrate/stream",
    summary="AI 配置迁移流式接口(SSE)",
)
async def migrate_stream(
    payload: ConfigMigrateRequest,
    config_path: str = Depends(get_project_config_path),
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
):
    """@methoddesc 脚本迁移流式端点

    创建 migrate job task 并通过 SSE 实时推送进度与终态。
    复用 _run_migrate_job 逻辑，通过 emit 回调桥接到 EventJournal + 事件队列。
    """
    from fastapi.responses import StreamingResponse

    from app.shared.services.ai.streaming.event_journal import EventJournal
    from app.shared.services.ai.streaming.sse_response import sse_event_stream

    job_id = f"job_migrate_{uuid.uuid4().hex[:12]}"
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

    journal_dir = _journal_dir_for(config_path)
    journal = EventJournal(job_id=job_id, journal_dir=journal_dir)
    event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def emit(event: str, data: dict[str, Any]) -> None:
        eid = journal.append(event, data)
        try:
            event_queue.put_nowait({"id": eid, "event": event, "data": data})
        except asyncio.QueueFull:
            pass

    task = asyncio.create_task(_run_migrate_job(job_id, payload, config_path, emit=emit))
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
    "/config/migrate/jobs/{job_id}/cancel",
    response_model=ConfigGenerateJobStatus,
    summary="取消迁移任务",
    responses={
        404: {"description": "任务未找到"},
    },
)
async def cancel_migrate_job(
    job_id: str, config_path: str = Depends(get_project_config_path)
) -> ConfigGenerateJobStatus:
    """取消迁移任务"""
    storage = _get_storage(config_path)
    status_data = storage.load_status(job_id)
    if not status_data:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    if status_data.get("status") in ("completed", "failed", "cancelled"):
        return ConfigGenerateJobStatus(**status_data)


@router.post(
    "/config/migrate/jobs/{job_id}/resume",
    summary="从最近 checkpoint 续跑迁移任务",
    responses={
        404: {"description": "无可用 checkpoint"},
    },
)
async def resume_migrate_job(
    job_id: str,
    config_path: str = Depends(get_project_config_path),
) -> dict[str, Any]:
    """从最近 checkpoint 续跑迁移任务"""
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

    payload = ConfigMigrateRequest(
        script_content=meta.get("script_content", ""),
        language=meta.get("language", "python"),
        file_paths=meta.get("file_paths", []),
        project_name=meta.get("project_name", ""),
        project_id=meta.get("project_id", ""),
        provider_id=meta.get("provider_id"),
        options=ConfigGenerateOptions(
            max_iterations=meta.get("max_iterations", 2),
        ),
    )

    status_data["status"] = "running"
    status_data["stage"] = "resuming"
    status_data["updated_at"] = _now_iso()
    storage.save_status(job_id, status_data)

    task = asyncio.create_task(_run_migrate_job(job_id, payload, config_path, initial_checkpoint=cp))
    with _job_tasks_lock:
        _job_tasks[job_id] = task

    return {"status": "resuming", "turn": cp.get("turn", 0)}
