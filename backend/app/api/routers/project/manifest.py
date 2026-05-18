"""
@fileoverview Manifest API - 项目清单管理

功能概述:
- 负责 project.precis.yaml 的读写操作
- 支持整体替换与合并写入（replace 参数控制）
- 提供 schema / constraint / regex 单个引用的更新接口

架构设计:
- Manifest 作为单一真相来源，记录所有资源的路径引用
- 资源文件分散存储在 schemas/、constraints/、regex/ 等目录
- 合并写入时保留原有未覆盖的引用，避免误删

输入示例:
    GET /v2/manifest
    PUT /v2/manifest (body: ProjectManifestV2, query: replace=false)
    PUT /v2/manifest/schema (body: SchemaRef)

输出示例:
    ProjectManifestV2: 项目清单对象
    StandardResponse: 操作结果消息
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.api.models.v2_responses import ManifestResponse
from app.shared.core.io.yaml import read_yaml, write_yaml_atomic
from app.shared.core.project.manifest.types import ConstraintRef, ProjectManifestV2, RegexRef, SchemaRef

from .base import (
    StandardResponse,
    _v2_manifest_path,
)
from .helpers import project_lock

router = APIRouter(prefix="", tags=["Project-Manifest"])


@router.get("/v2/manifest", response_model=ManifestResponse)
def get_v2_manifest(config_path: str = Depends(get_project_config_path)):
    """
    读取当前项目的 V2 清单（project.precis.yaml）。

    使用场景：
    - 前端获取项目概览时
    - 各资源 API 需要定位资源文件路径时
    - 全量校验时需要获取所有资源引用时

    副作用：
    - 如果 manifest 文件不存在，返回 404 错误

    数据流：
    1. 计算 manifest 文件路径
    2. 检查文件是否存在
    3. 读取并解析 YAML 文件
    4. 转换为 Pydantic 模型返回

    参数:
        config_path: 项目配置根目录（通过 Depends 注入）

    返回:
        ProjectManifestV2: 项目清单对象，包含 schemas/constraints/regex_nodes 引用列表
    """
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail=f"V2 清单文件未找到: {manifest_path}")
    data = read_yaml(Path(manifest_path))
    return ProjectManifestV2.model_validate(data)


@router.put("/v2/manifest", response_model=StandardResponse)
def put_v2_manifest(
    manifest: ProjectManifestV2, config_path: str = Depends(get_project_config_path), replace: bool = False
):
    """
    写入当前项目的 V2 清单。

    参数:
        manifest: 项目清单数据
        config_path: 项目配置根目录（通过 Depends 注入）
        replace: 是否完全替换（默认 False，即合并写）

    当 replace=False（默认）时，使用合并策略：
    - 保留原有的 schemas 中不在当前 manifest 中的引用
    - 保留原有的 constraints 中不在当前 manifest 中的引用
    - 保留原有的 regex_nodes 中不在当前 manifest 中的引用

    当 replace=True 时，完全替换现有清单。

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)

    with project_lock(config_path):
        existing_manifest = None

        if os.path.isfile(manifest_path):
            try:
                existing_data = read_yaml(Path(manifest_path))
                if existing_data:
                    existing_manifest = ProjectManifestV2.model_validate(existing_data)
            except Exception:
                logging.exception("读取manifest文件失败")

        if replace or not existing_manifest:
            final_manifest = manifest
        else:
            merged_schemas = manifest.schemas.copy() if manifest.schemas else []
            merged_constraints = manifest.constraints.copy() if manifest.constraints else []
            merged_regex_nodes = manifest.regex_nodes.copy() if manifest.regex_nodes else []

            existing_schema_ids = {s.id for s in merged_schemas}
            existing_constraint_ids = {c.id for c in merged_constraints}
            existing_regex_ids = {r.id for r in merged_regex_nodes}

            for s in existing_manifest.schemas or []:
                if s.id not in existing_schema_ids:
                    merged_schemas.append(s)

            for c in existing_manifest.constraints or []:
                if c.id not in existing_constraint_ids:
                    merged_constraints.append(c)

            for r in existing_manifest.regex_nodes or []:
                if r.id not in existing_regex_ids:
                    merged_regex_nodes.append(r)

            final_manifest = ProjectManifestV2(
                version=manifest.version,
                project=manifest.project,
                settings=manifest.settings,
                schemas=merged_schemas,
                constraints=merged_constraints,
                regex_nodes=merged_regex_nodes,
                data_sources=manifest.data_sources,
                patterns_dir=manifest.patterns_dir,
                warnings=manifest.warnings,
            )

        write_yaml_atomic(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    return {"message": "V2 manifest 已保存。"}


@router.put("/v2/manifest/schema", response_model=StandardResponse)
def update_manifest_schema_ref(schema_ref: SchemaRef, config_path: str = Depends(get_project_config_path)):
    """
    更新 manifest 中单个 schema 引用。

    逻辑：
    - 如果 schema_ref.id 已存在，则更新其 path
    - 如果不存在，则添加新引用

    参数:
        schema_ref: 单个 schema 引用（id + path）
        config_path: 项目配置根目录

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)

    with project_lock(config_path):
        existing_manifest = None
        if os.path.isfile(manifest_path):
            try:
                existing_data = read_yaml(Path(manifest_path))
                if existing_data:
                    existing_manifest = ProjectManifestV2.model_validate(existing_data)
            except Exception:
                logging.exception("读取manifest文件失败")

        if not existing_manifest:
            raise HTTPException(status_code=404, detail="Manifest 文件不存在，请先保存项目")

        schemas = existing_manifest.schemas or []
        schema_ids = {s.id for s in schemas}

        if schema_ref.id in schema_ids:
            for i, s in enumerate(schemas):
                if s.id == schema_ref.id:
                    schemas[i] = schema_ref
                    break
        else:
            schemas.append(schema_ref)

        final_manifest = ProjectManifestV2(
            version=existing_manifest.version,
            project=existing_manifest.project,
            settings=existing_manifest.settings,
            schemas=schemas,
            constraints=existing_manifest.constraints,
            regex_nodes=existing_manifest.regex_nodes,
            data_sources=existing_manifest.data_sources,
            patterns_dir=existing_manifest.patterns_dir,
            warnings=existing_manifest.warnings,
        )

        write_yaml_atomic(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    return {"message": f"Schema 引用 '{schema_ref.id}' 已更新"}


@router.put("/v2/manifest/constraint", response_model=StandardResponse)
def update_manifest_constraint_ref(constraint_ref: ConstraintRef, config_path: str = Depends(get_project_config_path)):
    """
    更新 manifest 中单个 constraint 引用。

    逻辑：
    - 如果 constraint_ref.id 已存在，则更新其 path
    - 如果不存在，则添加新引用

    参数:
        constraint_ref: 单个 constraint 引用（id + path）
        config_path: 项目配置根目录

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)

    with project_lock(config_path):
        existing_manifest = None
        if os.path.isfile(manifest_path):
            try:
                existing_data = read_yaml(Path(manifest_path))
                if existing_data:
                    existing_manifest = ProjectManifestV2.model_validate(existing_data)
            except Exception:
                logging.exception("读取manifest文件失败")

        if not existing_manifest:
            raise HTTPException(status_code=404, detail="Manifest 文件不存在，请先保存项目")

        constraints = existing_manifest.constraints or []
        constraint_ids = {c.id for c in constraints}

        if constraint_ref.id in constraint_ids:
            for i, c in enumerate(constraints):
                if c.id == constraint_ref.id:
                    constraints[i] = constraint_ref
                    break
        else:
            constraints.append(constraint_ref)

        final_manifest = ProjectManifestV2(
            version=existing_manifest.version,
            project=existing_manifest.project,
            settings=existing_manifest.settings,
            schemas=existing_manifest.schemas,
            constraints=constraints,
            regex_nodes=existing_manifest.regex_nodes,
            data_sources=existing_manifest.data_sources,
            patterns_dir=existing_manifest.patterns_dir,
            warnings=existing_manifest.warnings,
        )

        write_yaml_atomic(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    return {"message": f"Constraint 引用 '{constraint_ref.id}' 已更新"}


@router.put("/v2/manifest/regex", response_model=StandardResponse)
def update_manifest_regex_ref(regex_ref: RegexRef, config_path: str = Depends(get_project_config_path)):
    """
    更新 manifest 中单个 regex 节点引用。

    逻辑：
    - 如果 regex_ref.id 已存在，则更新其 path
    - 如果不存在，则添加新引用

    参数:
        regex_ref: 单个 regex 节点引用（id + path）
        config_path: 项目配置根目录

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)

    with project_lock(config_path):
        existing_manifest = None
        if os.path.isfile(manifest_path):
            try:
                existing_data = read_yaml(Path(manifest_path))
                if existing_data:
                    existing_manifest = ProjectManifestV2.model_validate(existing_data)
            except Exception:
                logging.exception("读取manifest文件失败")

        if not existing_manifest:
            raise HTTPException(status_code=404, detail="Manifest 文件不存在，请先保存项目")

        regex_nodes = existing_manifest.regex_nodes or []
        regex_ids = {r.id for r in regex_nodes}

        if regex_ref.id in regex_ids:
            for i, r in enumerate(regex_nodes):
                if r.id == regex_ref.id:
                    regex_nodes[i] = regex_ref
                    break
        else:
            regex_nodes.append(regex_ref)

        final_manifest = ProjectManifestV2(
            version=existing_manifest.version,
            project=existing_manifest.project,
            settings=existing_manifest.settings,
            schemas=existing_manifest.schemas,
            constraints=existing_manifest.constraints,
            regex_nodes=regex_nodes,
            data_sources=existing_manifest.data_sources,
            patterns_dir=existing_manifest.patterns_dir,
            warnings=existing_manifest.warnings,
        )

        write_yaml_atomic(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    return {"message": f"Regex 引用 '{regex_ref.id}' 已更新"}
