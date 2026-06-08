"""
@fileoverview 项目工作区 API - 多标签页画布状态持久化

功能概述:
- 提供前端多工作区（multi-tab canvas）的读写接口
- 工作区只存储视图差异（可见节点、视口），不存储完整项目配置
- 项目配置仍由 V2 YAML 体系（manifest/schema/constraint/regex）承载

架构设计:
- 与 project.view.json 分工协作：view.json 存节点坐标，workspaces.json 存工作区列表
- 文件不存在时返回默认空配置，保证前端始终能获取有效数据
- 使用 JSON 格式，便于前端快速序列化/反序列化

输入示例:
    GET /v2/workspaces
    PUT /v2/workspaces (body: WorkspacesV2Model)

输出示例:
    WorkspacesV2Model: {version, activeWorkspaceId, workspaces}
    StandardResponse: 操作结果消息
"""

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path

from .base import (
    StandardResponse,
    WorkspacesV2Model,
    _v2_workspaces_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Workspaces"])


@router.get(
    "/v2/workspaces",
    response_model=WorkspacesV2Model,
    summary="获取 V2 项目工作区配置",
    responses={
        500: {"description": "读取工作区文件失败"},
    },
)
def get_v2_workspaces(config_path: str = Depends(get_project_config_path)) -> WorkspacesV2Model:
    """
    获取 V2 项目工作区配置。

    使用场景：
    - 前端加载项目时恢复多标签页工作区状态
    - 用户刷新页面后恢复之前的工作区列表和活跃标签

    副作用：
    - 如果工作区文件不存在，返回默认空配置而非 404，保证前端总能拿到有效数据

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        WorkspacesV2Model: 包含工作区列表和当前活跃工作区 ID
    """
    workspaces_path = _v2_workspaces_path(config_path)
    if not os.path.isfile(workspaces_path):
        return WorkspacesV2Model(version=1, activeWorkspaceId=None, workspaces=[])

    try:
        with open(workspaces_path, encoding="utf-8") as f:
            data = json.load(f) or {}
        return WorkspacesV2Model(**data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取工作区文件失败: {e}")


@router.put(
    "/v2/workspaces",
    response_model=StandardResponse,
    summary="更新 V2 项目工作区配置",
    responses={
        500: {"description": "写入工作区文件失败"},
    },
)
def put_v2_workspaces(
    payload: WorkspacesV2Model,
    config_path: str = Depends(get_project_config_path),
) -> StandardResponse:
    """
    更新 V2 项目工作区配置。

    使用场景：
    - 用户创建/重命名/关闭工作区标签页时保存状态
    - 用户切换活跃工作区时保存当前选择
    - 用户拖拽排序工作区时保存新顺序

    副作用：
    - 自动创建 .precis 目录（如果不存在）
    - 直接覆盖写入工作区文件
    - 使用 ensure_ascii=False 支持中文工作区名称

    参数:
        payload: 前端传来的工作区数据
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    workspaces_path = _v2_workspaces_path(config_path)
    try:
        os.makedirs(os.path.dirname(workspaces_path), exist_ok=True)
        with open(workspaces_path, "w", encoding="utf-8") as f:
            json.dump(payload.model_dump(), f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入工作区文件失败: {e}")

    return StandardResponse(message="Workspaces saved")
