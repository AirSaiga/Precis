"""@fileoverview 校验历史 API 端点

提供校验结果的持久化存储和查询接口。
"""

from __future__ import annotations

import datetime
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.shared.services.validation.history import (
    ValidationHistoryStore,
    ValidationRunRecord,
    generate_run_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/validation/history", tags=["validation-history"])


def _get_store(project_path: str) -> ValidationHistoryStore:
    """
    @methoddesc 获取项目对应的校验历史存储实例

    每次请求重新创建实例，确保数据最新（本地文件读取开销极小）

    参数:
        project_path: 项目配置根目录

    返回:
        ValidationHistoryStore 实例
    """
    # 每次请求重新创建实例，确保数据最新（本地文件读取开销极小）
    return ValidationHistoryStore(project_path)


class SaveRunRequest(BaseModel):
    """保存校验运行记录请求"""

    project_path: str = Field(..., description="项目路径")
    duration_ms: int = Field(..., description="校验耗时（毫秒）")
    scope: str = Field(default="full", description="校验范围（full/incremental）")
    summary: dict[str, Any] = Field(..., description="汇总统计")
    by_type: dict[str, dict[str, int]] = Field(default_factory=dict, description="按校验类型统计")
    by_table: dict[str, dict[str, int]] = Field(default_factory=dict, description="按表统计")
    errors: list[dict[str, Any]] = Field(default_factory=list, description="错误列表")
    warnings: list[str] = Field(default_factory=list, description="警告信息")


@router.post(
    "",
    summary="保存校验运行记录",
    responses={
        500: {"description": "服务器内部错误"},
    },
)
def save_run(req: SaveRunRequest) -> dict[str, Any]:
    """
    @methoddesc 保存一次校验运行的完整记录

    业务用途:
    - 由前端在执行全量/单条校验后调用，将结果落地到项目本地
    - 自动生成 run_id 与时间戳，供后续查询/统计/历史面板展示

    参数:
        req: 包含运行汇总、按类型/表分组统计、错误列表等的请求

    返回:
        {"success": True, "run_id": str} 字典
    """
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
    """
    @methoddesc 分页获取校验运行记录列表

    业务用途:
    - 为前端历史记录面板提供数据
    - 按时间倒序返回，limit 限制最大 100，offset 用于分页

    参数:
        project_path: 项目路径
        limit: 每页大小，1-100
        offset: 偏移量

    返回:
        包含 runs/items/total 字段的字典
    """
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
    """
    @methoddesc 获取最近 N 次校验运行的统计信息

    业务用途:
    - 用于前端仪表盘展示趋势、平均耗时、通过率等指标

    参数:
        project_path: 项目路径
        last_n: 统计最近 N 条记录，1-50

    返回:
        统计信息字典
    """
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
    """
    @methoddesc 获取指定 run_id 的完整校验运行记录

    业务用途:
    - 用户在历史面板点击某条记录时展示完整错误详情

    参数:
        run_id: 运行记录唯一标识
        project_path: 项目路径

    返回:
        完整运行记录字典

    异常:
        HTTPException: 记录不存在(404)
    """
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
    """
    @methoddesc 删除指定 run_id 的校验运行记录

    业务用途:
    - 用户在历史面板点击"删除"按钮时调用

    参数:
        run_id: 运行记录唯一标识
        project_path: 项目路径

    返回:
        {"success": True} 字典

    异常:
        HTTPException: 记录不存在(404)
    """
    store = _get_store(project_path)
    deleted = store.delete_run(run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"记录不存在: {run_id}")
    return {"success": True}
