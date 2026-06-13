"""@fileoverview AI 配置迁移任务 API 路由模块

功能概述:
- 创建异步配置迁移任务（从旧脚本迁移生成 Precis 配置）
- 复用 Agent 内核和任务持久化
"""

from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends

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

_job_tasks: dict[str, asyncio.Task] = {}
_job_tasks_lock = threading.Lock()
_JOB_TTL_HOURS = 24.0


def _get_storage(config_path: str) -> AgentJobStorage:
    """获取指定项目的持久化存储实例。"""
    return AgentJobStorage(config_path)


def _now_iso() -> str:
    """返回当前 UTC 时间 ISO 字符串。"""
    return datetime.now(timezone.utc).isoformat()


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


async def _run_migrate_job(job_id: str, payload: ConfigMigrateRequest, config_path: str):
    """后台执行迁移任务"""
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
        return job_status

    update_status("running", stage="initializing", progress=0.0)

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
        extra = extra or {}
        update_status(
            "running",
            stage=stage,
            progress=min(progress * 100.0, 100.0),
            iterations=extra.get("iterations"),
            metrics=extra.get("metrics"),
        )

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

        update_status(
            "completed",
            stage="completed",
            progress=100.0,
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
