from __future__ import annotations

import os

import yaml
from fastapi import APIRouter, HTTPException, Request

from app.api.models.projects import (
    CloseProjectResponse,
    CurrentProjectResponse,
    OpenProjectRequest,
    OpenProjectResponse,
)

router = APIRouter(prefix="", tags=["Projects-Open"])


def _get_project_name(project_path: str) -> str:
    """从 project.precis.yaml 中读取项目名称，失败时返回目录名。"""
    manifest_path = os.path.join(project_path, "project.precis.yaml")
    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = yaml.safe_load(f)
        if isinstance(manifest, dict):
            project = manifest.get("project", {})
            if isinstance(project, dict):
                name = project.get("name")
                if name:
                    return str(name)
    except Exception:
        pass
    return os.path.basename(project_path)


@router.post(
    "/open",
    response_model=OpenProjectResponse,
    summary="打开一个 Precis 项目",
)
def open_project(
    request: OpenProjectRequest,
    http_request: Request,
) -> OpenProjectResponse:
    """打开指定路径的项目，将其设置为"当前项目"。"""
    project_path = os.path.abspath(os.path.normpath(request.path))
    if not os.path.isdir(project_path):
        raise HTTPException(status_code=404, detail=f"项目目录不存在: {project_path}")

    manifest_path = os.path.join(project_path, "project.precis.yaml")
    if not os.path.isfile(manifest_path):
        raise HTTPException(
            status_code=400,
            detail=f"目录不是有效的 Precis 项目（缺少 project.precis.yaml）: {project_path}",
        )

    name = _get_project_name(project_path)
    http_request.app.state.current_project_path = project_path
    http_request.app.state.current_project_name = name

    return OpenProjectResponse(success=True, name=name, path=project_path)


@router.get(
    "/current",
    response_model=CurrentProjectResponse,
    summary="获取当前打开的项目信息",
)
def get_current_project(http_request: Request) -> CurrentProjectResponse:
    """返回当前打开的项目路径和名称。"""
    path = getattr(http_request.app.state, "current_project_path", None)
    if not path:
        return CurrentProjectResponse(has_current=False)
    name = getattr(http_request.app.state, "current_project_name", None) or os.path.basename(path)
    return CurrentProjectResponse(has_current=True, path=path, name=name)


@router.post(
    "/close",
    response_model=CloseProjectResponse,
    summary="关闭当前项目",
)
def close_project(http_request: Request) -> CloseProjectResponse:
    """关闭当前项目，清除状态。"""
    http_request.app.state.current_project_path = None
    http_request.app.state.current_project_name = None
    return CloseProjectResponse(success=True)
