"""
@fileoverview AI 异步配置生成任务 API 路由模块

功能概述:
- 创建异步配置生成任务，避免大文件场景阻塞请求
- 查询任务执行状态和进度
- 支持取消正在运行的任务
- 内存中任务存储（含自动清理机制）

架构设计:
- 使用 asyncio.create_task 在后台执行生成任务
- 通过内存字典 _jobs 和 _job_tasks 管理任务状态
- 支持进度回调，实时更新任务阶段和进度百分比
- 超过最大任务数时自动清理已完成任务

输入示例:
    POST /ai/v2/config/generate/jobs
    {
        "file_paths": ["data/users.xlsx"],
        "project_name": "用户数据项目",
        "project_id": "user-data"
    }

输出示例:
    {"job_id": "job_a1b2c3d4e5f6"}
"""

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.shared.services.llm.generation import (
    CancelledError,
    ConfigGenerationService,
    GenerationOptions,
    GenerationParseError,
    ProfilingOptions,
)

from .models import ConfigGenerateJobCreateResponse, ConfigGenerateJobStatus, ConfigGenerateRequest
from .router import router

# 内存中的任务存储（生产环境应使用 Redis/数据库）
_jobs: dict[str, ConfigGenerateJobStatus] = {}
_job_tasks: dict[str, asyncio.Task] = {}
_jobs_lock = asyncio.Lock()
_MAX_JOBS = 100  # 最大保留任务数，超出时淘汰最早完成的任务


def _cleanup_old_jobs():
    """清理旧任务，防止内存无限增长"""
    if len(_jobs) <= _MAX_JOBS:
        return

    # 按 updated_at 排序，保留最近完成的任务和运行中的任务
    sorted_jobs = sorted(
        _jobs.items(),
        key=lambda x: x[1].updated_at or "",
    )
    # 只清理已完成/失败/取消的任务
    to_remove = []
    for job_id, job in sorted_jobs:
        if job.status in ("completed", "failed", "cancelled"):
            to_remove.append(job_id)
        if len(_jobs) - len(to_remove) <= _MAX_JOBS:
            break

    for job_id in to_remove:
        _jobs.pop(job_id, None)
        _job_tasks.pop(job_id, None)


@router.post(
    "/v2/config/generate/jobs",
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
    now = datetime.now(timezone.utc).isoformat()

    # 清理旧任务
    async with _jobs_lock:
        _cleanup_old_jobs()

        # 创建任务记录
        _jobs[job_id] = ConfigGenerateJobStatus(
            job_id=job_id, status="pending", created_at=now, updated_at=now, warnings=[]
        )

        # 在后台运行任务（保存 Task 句柄以便取消）
        task = asyncio.create_task(_run_job(job_id, payload, config_path))
        _job_tasks[job_id] = task

    return ConfigGenerateJobCreateResponse(job_id=job_id)


async def _run_job(job_id: str, payload: ConfigGenerateRequest, config_path: str):
    """后台执行任务"""
    async with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.status = "running"
        job.stage = "initializing"
        job.updated_at = datetime.now(timezone.utc).isoformat()

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

    def progress_callback(stage: str, progress: float):
        with _jobs_lock:
            current_job = _jobs.get(job_id)
            if current_job and current_job.status == "cancelled":
                service.cancel()
            if current_job:
                current_job.stage = stage
                current_job.progress = progress
                current_job.updated_at = datetime.now(timezone.utc).isoformat()

    try:
        result = await service.generate(
            file_paths=payload.file_paths,
            project_name=payload.project_name,
            project_id=payload.project_id,
            config_path=config_path,
            profiling_options=profiling_opts,
            generation_options=gen_opts,
            progress_callback=progress_callback,
        )

        # 任务完成
        from .models import ConfigGenerateResponse

        async with _jobs_lock:
            job.status = "completed"
            job.stage = "completed"
            job.progress = 100.0
            job.result = ConfigGenerateResponse(
                success=result["success"],
                yaml_preview=result["yaml_preview"],
                manifest=result["manifest"],
                schemas=result["schemas"],
                constraints=result["constraints"],
                regex_nodes=result["regex_nodes"],
                warnings=result.get("warnings", []),
                error=result.get("error"),
            )
            job.warnings = result.get("warnings", [])

    except CancelledError:
        async with _jobs_lock:
            job.status = "cancelled"
            job.stage = "cancelled"
            job.error = "任务已取消"
    except GenerationParseError as e:
        async with _jobs_lock:
            job.status = "failed"
            job.stage = "error"
            job.error = f"配置解析失败: {e}"
    except Exception as e:
        async with _jobs_lock:
            job.status = "failed"
            job.stage = "error"
            job.error = str(e)

    async with _jobs_lock:
        job.updated_at = datetime.now(timezone.utc).isoformat()
        _job_tasks.pop(job_id, None)


@router.get(
    "/v2/config/generate/jobs/{job_id}",
    response_model=ConfigGenerateJobStatus,
    summary="获取任务状态",
    responses={
        404: {"description": "任务未找到"},
    },
)
async def get_generate_job(job_id: str) -> ConfigGenerateJobStatus:
    """获取任务状态"""
    async with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        return job


@router.post(
    "/v2/config/generate/jobs/{job_id}/cancel",
    response_model=ConfigGenerateJobStatus,
    summary="取消任务",
    responses={
        404: {"description": "任务未找到"},
    },
)
async def cancel_generate_job(job_id: str) -> ConfigGenerateJobStatus:
    """取消任务"""
    async with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

        if job.status in ("completed", "failed", "cancelled"):
            return job

        # 标记取消状态
        job.status = "cancelled"
        job.stage = "cancelled"
        job.updated_at = datetime.now(timezone.utc).isoformat()

        # 真正取消运行中的任务
        task = _job_tasks.get(job_id)
        if task and not task.done():
            task.cancel()

    return job
