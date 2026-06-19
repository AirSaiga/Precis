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
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, HTTPException

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
    return datetime.now(timezone.utc).isoformat()


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


async def _run_job(job_id: str, payload: ConfigGenerateRequest, config_path: str):
    """后台执行任务"""
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
        return job_status

    update_status("running", stage="initializing", progress=0.0)

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
