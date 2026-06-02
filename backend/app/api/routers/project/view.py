"""
@fileoverview 项目视图 API - 画布布局管理

功能概述:
- 提供前端画布视图（节点位置、视口信息）的读写接口
- 视图文件与 manifest 分离，避免 UI 状态污染配置语义
- 文件不存在时返回默认空视图，保证前端始终能获取有效数据

架构设计:
- 使用 JSON 格式存储，便于前端快速序列化/反序列化
- 读取时兜底返回默认视图，写入时直接覆盖
- 通过 _v2_view_path 统一计算视图文件路径

输入示例:
    GET /v2/view
    PUT /v2/view (body: ProjectViewV2Model)

输出示例:
    ProjectViewV2Model: {version, nodes, viewport}
    StandardResponse: 操作结果消息
"""

import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path

from .base import (
    ProjectViewV2Model,
    StandardResponse,
    _v2_view_path,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-View"])


@router.get("/v2/view", response_model=ProjectViewV2Model)
def get_v2_project_view(config_path: str = Depends(get_project_config_path)) -> ProjectViewV2Model:
    """
    获取 V2 项目视图文件（画布布局）。

    使用场景：
    - 前端加载项目时恢复画布节点位置
    - 用户打开已保存的项目时恢复之前的查看位置

    副作用：
    - 如果视图文件不存在，返回默认空视图而非 404，保证前端总能拿到有效数据

    数据流：
    1. 尝试从文件系统读取 project.view.json
    2. 如果文件不存在，返回默认视图 {version: 1, nodes: {}, viewport: null}
    3. 如果读取失败（如 JSON 解析错误），返回 500 错误

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ProjectViewV2Model: 包含节点位置和视口信息
    """
    view_path = _v2_view_path(config_path)
    if not os.path.isfile(view_path):
        return ProjectViewV2Model(version=1, nodes={})

    try:
        with open(view_path, encoding="utf-8") as f:
            data = json.load(f) or {}
        return ProjectViewV2Model(**data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取视图文件失败: {e}")


@router.put("/v2/view", response_model=StandardResponse)
def put_v2_project_view(
    payload: ProjectViewV2Model,
    config_path: str = Depends(get_project_config_path),
) -> StandardResponse:
    """
    更新 V2 项目视图文件（画布布局）。

    使用场景：
    - 用户拖拽节点后保存位置
    - 用户缩放/平移画布后保存视口
    - 定期自动保存画布状态

    副作用：
    - 直接覆盖写入视图文件
    - 使用 ensure_ascii=False 支持中文节点名称

    数据流：
    1. 接收前端传来的视图数据（节点坐标 + 视口）
    2. 转换为 JSON 格式写入文件
    3. 返回成功消息

    参数:
        payload: 前端传来的视图数据
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        StandardResponse: 操作结果消息
    """
    view_path = _v2_view_path(config_path)
    try:
        with open(view_path, "w", encoding="utf-8") as f:
            json.dump(payload.model_dump(), f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入视图文件失败: {e}")

    return StandardResponse(message="Project view saved")
