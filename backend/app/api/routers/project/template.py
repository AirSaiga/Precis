"""
@fileoverview Template CRUD API - 可复用约束模板管理

功能概述:
- 提供模板定义文件的增删改查
- 提供模板展开预览接口
- 读取时从 manifest.templates 定位文件

架构设计:
- 读取时从 manifest.templates 中查找引用
- 写入时自动补齐 manifest 引用，默认路径为 templates/{id}.template.yaml
- 展开预览不写入文件，仅返回展开结果
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml_atomic
from app.shared.core.project.template.expander import expand_template
from app.shared.core.project.template.reader import load_template
from app.shared.core.project.template.types import TemplateFile

from .helpers import _resolve_project_path, project_lock
from .manifest import get_v2_manifest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Template"])


def _v2_manifest_path(config_path: str) -> Path:
    """获取 manifest 文件路径"""
    return _resolve_project_path(config_path) / "project.precis.yaml"


def _find_template_path(template_id: str, config_path: str) -> Path | None:
    """从 manifest 中查找模板文件路径"""
    manifest = get_v2_manifest(config_path)
    for ref in manifest.templates:
        if ref.id == template_id:
            return _resolve_project_path(config_path) / ref.path
    return None


# ============================================================================
# 请求/响应模型
# ============================================================================


class TemplateExpandRequest(BaseModel):
    """模板展开预览请求"""

    instance_id: str
    params: dict[str, Any] = {}
    input_from_node: str = ""


class TemplateExpandResponse(BaseModel):
    """模板展开预览响应"""

    transforms: list[dict[str, Any]]
    constraints: list[dict[str, Any]]
    regex_nodes: list[dict[str, Any]]


class StandardResponse(BaseModel):
    """标准操作响应"""

    success: bool
    message: str


# ============================================================================
# CRUD 端点
# ============================================================================


@router.get("/v2/template")
def list_templates(config_path: str = Depends(get_project_config_path)):
    """列出所有模板定义"""
    manifest = get_v2_manifest(config_path)
    templates = []
    for ref in manifest.templates:
        tmpl_path = _resolve_project_path(config_path) / ref.path
        if tmpl_path.exists():
            try:
                tmpl = load_template(tmpl_path)
                templates.append(
                    {
                        "id": tmpl.id,
                        "name": tmpl.name,
                        "description": tmpl.description,
                        "parameter_count": len(tmpl.parameters),
                        "node_count": len(tmpl.nodes),
                        "path": ref.path,
                    }
                )
            except Exception as e:
                logger.warning(f"模板 '{ref.id}' 加载失败: {e}")
    return templates


@router.get("/v2/template/{template_id}")
def get_template(template_id: str, config_path: str = Depends(get_project_config_path)):
    """读取指定模板定义"""
    tmpl_path = _find_template_path(template_id, config_path)
    if not tmpl_path or not tmpl_path.exists():
        raise HTTPException(status_code=404, detail=f"模板 '{template_id}' 不存在")
    tmpl = load_template(tmpl_path)
    return tmpl.model_dump()


@router.post("/v2/template")
def create_template(template_data: dict, config_path: str = Depends(get_project_config_path)):
    """创建模板定义文件"""
    project_dir = _resolve_project_path(config_path)

    # 验证数据
    try:
        tmpl = TemplateFile.model_validate(template_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"模板数据验证失败: {e}")

    # 确保目录存在
    templates_dir = project_dir / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)

    # 写入文件
    file_path = templates_dir / f"{tmpl.id}.template.yaml"
    if file_path.exists():
        raise HTTPException(status_code=409, detail=f"模板文件已存在: {file_path.name}")

    write_yaml_atomic(file_path, tmpl.model_dump(exclude_none=True))

    # 更新 manifest
    manifest_path = _v2_manifest_path(config_path)
    with project_lock(config_path):
        manifest_data = read_yaml(manifest_path)
        templates_list = manifest_data.get("templates") or []
        templates_list.append({"id": tmpl.id, "path": f"templates/{tmpl.id}.template.yaml"})
        manifest_data["templates"] = templates_list
        write_yaml_atomic(manifest_path, manifest_data)

    return StandardResponse(success=True, message=f"模板 '{tmpl.id}' 创建成功")


@router.put("/v2/template/{template_id}")
def update_template(
    template_id: str,
    template_data: dict,
    config_path: str = Depends(get_project_config_path),
):
    """更新模板定义文件"""
    tmpl_path = _find_template_path(template_id, config_path)
    if not tmpl_path or not tmpl_path.exists():
        raise HTTPException(status_code=404, detail=f"模板 '{template_id}' 不存在")

    # 验证数据
    try:
        tmpl = TemplateFile.model_validate(template_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"模板数据验证失败: {e}")

    write_yaml_atomic(tmpl_path, tmpl.model_dump(exclude_none=True))
    return StandardResponse(success=True, message=f"模板 '{template_id}' 更新成功")


@router.delete("/v2/template/{template_id}")
def delete_template(template_id: str, config_path: str = Depends(get_project_config_path)):
    """删除模板定义文件"""
    tmpl_path = _find_template_path(template_id, config_path)
    if not tmpl_path or not tmpl_path.exists():
        raise HTTPException(status_code=404, detail=f"模板 '{template_id}' 不存在")

    # 删除文件
    tmpl_path.unlink()

    # 更新 manifest
    manifest_path = _v2_manifest_path(config_path)
    with project_lock(config_path):
        manifest_data = read_yaml(manifest_path)
        templates_list = manifest_data.get("templates") or []
        manifest_data["templates"] = [t for t in templates_list if t.get("id") != template_id]
        write_yaml_atomic(manifest_path, manifest_data)

    return StandardResponse(success=True, message=f"模板 '{template_id}' 删除成功")


@router.post("/v2/template/{template_id}/expand", response_model=TemplateExpandResponse)
def preview_template_expand(
    template_id: str,
    request: TemplateExpandRequest,
    config_path: str = Depends(get_project_config_path),
):
    """预览模板展开结果（不写入文件）"""
    tmpl_path = _find_template_path(template_id, config_path)
    if not tmpl_path or not tmpl_path.exists():
        raise HTTPException(status_code=404, detail=f"模板 '{template_id}' 不存在")

    tmpl = load_template(tmpl_path)

    try:
        transforms, constraints, regex_nodes = expand_template(
            tmpl,
            request.instance_id,
            request.params,
            request.input_from_node,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return TemplateExpandResponse(
        transforms=[t.model_dump(exclude_none=True) for t in transforms],
        constraints=[c.model_dump(exclude_none=True) for c in constraints],
        regex_nodes=[r.model_dump(exclude_none=True) for r in regex_nodes],
    )
