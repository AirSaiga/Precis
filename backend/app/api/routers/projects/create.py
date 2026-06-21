"""
@fileoverview Web 端新建项目 API

功能概述:
- 创建一个新的 Precis 项目脚手架
- 生成标准目录结构与最小 manifest
- 设置为"当前项目"

架构设计:
- 与 open.py 对称：create 写入脚手架，open 验证并加载
- Web 模式下文件系统可见，直接在请求路径下创建
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.api.models.projects import CreateProjectRequest, CreateProjectResponse
from app.shared.core.io.yaml import write_yaml_atomic

router = APIRouter(prefix="", tags=["Projects-Create"])

# 标准项目子目录
_REQUIRED_SUBDIRS = [
    "schemas",
    "constraints",
    "regex_nodes",
    "transforms",
    "patterns",
    "templates",
    "data",
    ".precis",
]


# 最小空项目 manifest 模板（与 qa_simple 结构对齐）
def _build_min_manifest(project_name: str) -> dict:
    """根据项目名构造最小可用 manifest。"""
    # id 由项目名派生：小写 + 仅保留字母数字与下划线
    raw_id = re.sub(r"[^a-zA-Z0-9_]", "_", project_name.strip().lower()) or "project"
    return {
        "version": 2,
        "project": {"id": raw_id, "name": project_name},
        "settings": {
            "validation": {
                "auto_validate": False,
                "strict_mode": False,
                "error_handling": "continue",
                "timeout_seconds": 30,
            },
            "file_processing": {"default_encoding": "utf-8"},
            "script_security": {"allow_eval": False, "allow_exec": False},
        },
        "schemas": [],
        "constraints": [],
        "regex_nodes": [],
        "transforms": [],
        "data_sources": [],
        "templates": [],
        "template_instances": [],
        "patterns_dir": "patterns",
        "warnings": [],
    }


@router.post(
    "/create",
    response_model=CreateProjectResponse,
    summary="创建一个新的 Precis 项目脚手架",
)
def create_project(
    request: CreateProjectRequest,
    http_request: Request,
) -> CreateProjectResponse:
    """创建项目目录、写入最小 manifest 与标准子目录，并将其设为当前项目。"""
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")

    project_path = os.path.abspath(os.path.normpath(request.path))
    manifest_path = os.path.join(project_path, "project.precis.yaml")

    # 若已是合法项目（manifest 存在），拒绝覆盖
    if os.path.isfile(manifest_path):
        raise HTTPException(
            status_code=400,
            detail=f"目录已是 Precis 项目（存在 manifest）: {project_path}",
        )

    # 创建目录与标准子目录
    os.makedirs(project_path, exist_ok=True)
    for sub in _REQUIRED_SUBDIRS:
        os.makedirs(os.path.join(project_path, sub), exist_ok=True)

    # 写入最小 manifest
    write_yaml_atomic(Path(manifest_path), _build_min_manifest(name))

    # 设为当前项目（与 open 行为一致）
    http_request.app.state.current_project_path = project_path
    http_request.app.state.current_project_name = name

    return CreateProjectResponse(success=True, name=name, path=project_path)
