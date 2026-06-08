"""@fileoverview 校验历史 API 端点

提供校验结果的持久化存储和查询接口。
"""

from __future__ import annotations

import datetime
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.shared.services.validation.history import (
    ValidationHistoryStore,
    ValidationRunRecord,
    generate_run_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/validation/history", tags=["validation-history"])


def _get_store(project_path: str) -> ValidationHistoryStore:
    # 每次请求重新创建实例，确保数据最新（本地文件读取开销极小）
    return ValidationHistoryStore(project_path)


class SaveRunRequest(BaseModel):
    project_path: str
    duration_ms: int
    scope: str = "full"
    summary: dict[str, Any]
    by_type: dict[str, dict[str, int]] = {}
    by_table: dict[str, dict[str, int]] = {}
    errors: list[dict[str, Any]] = []
    warnings: list[str] = []


@router.post(
    "",
    summary="保存校验运行记录",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def save_run(req: SaveRunRequest) -> dict[str, Any]:
    store = _get_store(req.project_path)
    record = ValidationRunRecord(
        id=generate_run_id(),
        timestamp=datetime.datetime.now().isoformat(),
        duration_ms=req.duration_ms,
        scope=req.scope,
        summary=req.summary,
        by_type=req.by_type,
        by_table=req.by_table,
        errors=req.errors,
        warnings=req.warnings,
    )
    run_id = store.add_run(record)
    return {"success": True, "run_id": run_id}


@router.get(
    "",
    summary="获取校验运行记录列表",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def list_runs(
    project_path: str = Query(..., description="项目路径"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    store = _get_store(project_path)
    return store.get_runs(limit=limit, offset=offset)


@router.get(
    "/stats",
    summary="获取校验运行统计信息",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def get_stats(
    project_path: str = Query(..., description="项目路径"),
    last_n: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    store = _get_store(project_path)
    return store.get_stats(last_n=last_n)


@router.get(
    "/{run_id}",
    summary="获取单条校验运行记录",
    responses={
        404: {"description": "记录不存在"},
    },
)
def get_run(run_id: str, project_path: str = Query(..., description="项目路径")) -> dict[str, Any]:
    store = _get_store(project_path)
    run = store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"记录不存在: {run_id}")
    return run


@router.delete(
    "/{run_id}",
    summary="删除校验运行记录",
    responses={
        404: {"description": "记录不存在"},
    },
)
def delete_run(run_id: str, project_path: str = Query(..., description="项目路径")) -> dict[str, Any]:
    store = _get_store(project_path)
    deleted = store.delete_run(run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"记录不存在: {run_id}")
    return {"success": True}
