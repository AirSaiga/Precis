from __future__ import annotations

import os
from datetime import datetime

import yaml
from fastapi import APIRouter, HTTPException, Query

from app.api.models.projects import ProjectInfo, ScanResponse

router = APIRouter(prefix="", tags=["Projects-Scan"])


@router.get(
    "/scan",
    response_model=ScanResponse,
    summary="扫描工作目录下的所有 Precis 项目",
)
def scan_projects(
    work_dir: str | None = Query(None, description="要扫描的工作目录绝对路径"),
) -> ScanResponse:
    """扫描指定工作目录，找出所有包含 project.precis.yaml 的子目录。"""
    if not work_dir:
        work_dir = os.environ.get("PRECIS_WORK_DIR")
    if not work_dir:
        raise HTTPException(
            status_code=400,
            detail="请指定 work_dir 参数或设置 PRECIS_WORK_DIR 环境变量",
        )

    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=400, detail=f"工作目录不存在: {work_dir}")

    projects: list[ProjectInfo] = []
    try:
        for entry in os.scandir(work_dir):
            if not entry.is_dir():
                continue
            manifest_path = os.path.join(entry.path, "project.precis.yaml")
            if not os.path.isfile(manifest_path):
                continue
            info = _parse_project(entry.path, manifest_path)
            if info:
                projects.append(info)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=f"无权限访问目录: {e}")

    projects.sort(key=lambda p: p.last_modified, reverse=True)
    return ScanResponse(work_dir=os.path.abspath(work_dir), projects=projects)


def _parse_project(project_path: str, manifest_path: str) -> ProjectInfo | None:
    """解析单个项目的 manifest 文件获取元信息。"""
    try:
        with open(manifest_path, encoding="utf-8") as f:
            manifest = yaml.safe_load(f)
    except Exception:
        return None

    if not isinstance(manifest, dict):
        return None

    project = manifest.get("project", {})
    if not isinstance(project, dict):
        return None

    name = project.get("name", os.path.basename(project_path))
    schemas = manifest.get("schemas", []) or []
    constraints = manifest.get("constraints", []) or []

    try:
        mtime = os.path.getmtime(manifest_path)
        last_modified = datetime.fromtimestamp(mtime).isoformat()
    except OSError:
        last_modified = ""

    return ProjectInfo(
        name=str(name),
        path=os.path.abspath(project_path),
        schema_count=len(schemas) if isinstance(schemas, list) else 0,
        constraint_count=len(constraints) if isinstance(constraints, list) else 0,
        last_modified=last_modified,
    )
