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
- 单个引用更新通过 _upsert_manifest_ref 收敛为统一入口

输入示例:
    GET /manifest
    PUT /manifest (body: ProjectManifestV2, query: replace=false)
    PUT /manifest/schema (body: SchemaRef)

输出示例:
    ProjectManifestV2: 项目清单对象
    StandardResponse: 操作结果消息
"""

import logging
import os
from pathlib import Path
from typing import Optional, Union

from fastapi import APIRouter, Depends, HTTPException

from app.api.dependencies import get_project_config_path
from app.api.models.v2_responses import ManifestResponse
from app.shared.core.io.yaml import read_yaml, write_yaml_atomic
from app.shared.core.project.manifest.types import ConstraintRef, ProjectManifestV2, RegexRef, SchemaRef
from app.shared.core.project.manifest.types_parts.template import TemplateInstanceRef

from .base import (
    StandardResponse,
    _v2_manifest_path,
)
from .helpers import project_lock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Manifest"])

# 引用类型联合，用于 _upsert_manifest_ref 的参数类型标注
_Ref = Union[SchemaRef, ConstraintRef, RegexRef]

# manifest 中引用列表字段名到资源类型中文标签的映射
_FIELD_LABEL_MAP: dict[str, str] = {
    "schemas": "Schema",
    "constraints": "Constraint",
    "regex_nodes": "Regex",
}


def _read_manifest(manifest_path: str) -> Optional[ProjectManifestV2]:
    """
    @methoddesc 从文件读取并解析 manifest

    参数:
        manifest_path: manifest 文件路径

    返回:
        解析后的 ProjectManifestV2 对象，文件不存在或解析失败返回 None
    """
    if not os.path.isfile(manifest_path):
        return None
    try:
        existing_data = read_yaml(Path(manifest_path))
        if existing_data:
            return ProjectManifestV2.model_validate(existing_data)
    except Exception:
        logger.exception("读取manifest文件失败: %s", manifest_path)
    return None


def _upsert_manifest_ref(
    config_path: str,
    field_name: str,
    ref: _Ref,
) -> StandardResponse:
    """
    @methoddesc 在 manifest 中对单个引用执行 upsert（更新或插入）

    通用入口函数，被 schema / constraint / regex 三个 PUT 端点共用。

    流程:
        1. 读取现有 manifest 文件
        2. 在指定字段对应的列表中按 id 查找
        3. 已存在则更新 path，不存在则追加
        4. 写回文件

    参数:
        config_path: 项目配置根目录
        field_name: manifest 中的引用列表字段名（schemas / constraints / regex_nodes）
        ref: 要 upsert 的引用对象（必须包含 id 字段）

    返回:
        StandardResponse: 操作结果消息

    抛出:
        HTTPException 404: manifest 文件不存在时
    """
    label = _FIELD_LABEL_MAP.get(field_name, field_name)
    manifest_path = _v2_manifest_path(config_path)

    with project_lock(config_path):
        existing_manifest = _read_manifest(manifest_path)

        if not existing_manifest:
            raise HTTPException(status_code=404, detail="Manifest 文件不存在，请先保存项目")

        # 获取当前引用列表（拷贝一份，避免就地修改原对象的列表）
        items = list(getattr(existing_manifest, field_name, None) or [])
        existing_ids = {item.id for item in items}

        # upsert: 已存在则替换，不存在则追加
        if ref.id in existing_ids:
            for i, item in enumerate(items):
                if item.id == ref.id:
                    items[i] = ref
                    break
        else:
            items.append(ref)

        # 使用 model_copy 避免手动重建整个对象
        updated_manifest = existing_manifest.model_copy(update={field_name: items})
        write_yaml_atomic(Path(manifest_path), updated_manifest.model_dump(exclude_none=True))

    return StandardResponse(message=f"{label} 引用 '{ref.id}' 已更新")


@router.get(
    "/manifest",
    response_model=ManifestResponse,
    summary="读取项目 V2 清单",
    responses={
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
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


@router.put(
    "/manifest",
    response_model=StandardResponse,
    summary="写入项目 V2 清单",
    responses={
        400: {"description": "请求参数错误"},
        500: {"description": "服务器内部错误"},
    },
)
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
        existing_manifest = _read_manifest(manifest_path)

        if replace or not existing_manifest:
            final_manifest = manifest
        else:
            merged_schemas = manifest.schemas.copy() if manifest.schemas else []
            merged_constraints = manifest.constraints.copy() if manifest.constraints else []
            merged_regex_nodes = manifest.regex_nodes.copy() if manifest.regex_nodes else []
            merged_templates = manifest.templates.copy() if manifest.templates else []
            merged_template_instances = manifest.template_instances.copy() if manifest.template_instances else []

            existing_schema_ids = {s.id for s in merged_schemas}
            existing_constraint_ids = {c.id for c in merged_constraints}
            existing_regex_ids = {r.id for r in merged_regex_nodes}
            existing_template_ids = {t.id for t in merged_templates}
            existing_instance_ids = {ti.id for ti in merged_template_instances}

            for s in existing_manifest.schemas or []:
                if s.id not in existing_schema_ids:
                    merged_schemas.append(s)

            for c in existing_manifest.constraints or []:
                if c.id not in existing_constraint_ids:
                    merged_constraints.append(c)

            for r in existing_manifest.regex_nodes or []:
                if r.id not in existing_regex_ids:
                    merged_regex_nodes.append(r)

            for t in existing_manifest.templates or []:
                if t.id not in existing_template_ids:
                    merged_templates.append(t)

            for ti in existing_manifest.template_instances or []:
                if ti.id not in existing_instance_ids:
                    merged_template_instances.append(ti)

            final_manifest = ProjectManifestV2(
                version=manifest.version,
                project=manifest.project,
                settings=manifest.settings,
                schemas=merged_schemas,
                constraints=merged_constraints,
                regex_nodes=merged_regex_nodes,
                transforms=manifest.transforms,
                data_sources=manifest.data_sources,
                templates=merged_templates,
                template_instances=merged_template_instances,
                patterns_dir=manifest.patterns_dir,
                warnings=manifest.warnings,
            )

        write_yaml_atomic(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    return {"message": "V2 manifest 已保存。"}


@router.put(
    "/manifest/schema",
    response_model=StandardResponse,
    summary="更新 manifest 中单个 Schema 引用",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
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
    return _upsert_manifest_ref(config_path, "schemas", schema_ref)


@router.put(
    "/manifest/constraint",
    response_model=StandardResponse,
    summary="更新 manifest 中单个 Constraint 引用",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
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
    return _upsert_manifest_ref(config_path, "constraints", constraint_ref)


@router.put(
    "/manifest/regex",
    response_model=StandardResponse,
    summary="更新 manifest 中单个 Regex 引用",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
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
    return _upsert_manifest_ref(config_path, "regex_nodes", regex_ref)


@router.put(
    "/manifest/template-instance",
    response_model=StandardResponse,
    summary="更新 manifest 中单个 Template Instance 引用",
    responses={
        400: {"description": "请求参数错误"},
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def update_manifest_template_instance_ref(
    instance_ref: TemplateInstanceRef,
    config_path: str = Depends(get_project_config_path),
):
    """
    更新 manifest 中单个 template_instance 引用。

    逻辑：
    - 如果 instance_ref.id 已存在，则更新其内容
    - 如果不存在，则添加新引用

    参数:
        instance_ref: 模板实例引用（id + template_id + enabled + input_from_node + params）
        config_path: 项目配置根目录

    返回:
        StandardResponse: 操作结果消息
    """
    manifest_path = _v2_manifest_path(config_path)

    with project_lock(config_path):
        existing_manifest = _read_manifest(manifest_path)

        if not existing_manifest:
            raise HTTPException(status_code=404, detail="Manifest 文件不存在，请先保存项目")

        items = list(existing_manifest.template_instances or [])
        existing_ids = {item.id for item in items}

        if instance_ref.id in existing_ids:
            for i, item in enumerate(items):
                if item.id == instance_ref.id:
                    items[i] = instance_ref
                    break
        else:
            items.append(instance_ref)

        updated_manifest = existing_manifest.model_copy(update={"template_instances": items})
        write_yaml_atomic(Path(manifest_path), updated_manifest.model_dump(exclude_none=True))

    return {"message": f"TemplateInstance 引用 '{instance_ref.id}' 已更新"}


@router.post(
    "/manifest/constraint/deduplicate",
    response_model=StandardResponse,
    summary="去重 manifest 中的 Constraint 引用",
    responses={
        404: {"description": "Manifest 不存在"},
        500: {"description": "服务器内部错误"},
    },
)
def deduplicate_constraint_refs(
    config_path: str = Depends(get_project_config_path),
):
    """
    @methoddesc 扫描 manifest.constraints，删除指向同文件但 id 不匹配的重复条目。

    算法:
    1. 读取所有 constraint 文件，建立 {path -> file.id} 映射
    2. 对每条 ref：
       - 如果存在另一条 ref 指向同 path 且 ref.id 与 file.id 一致（"正确条目"）
       - 且当前 ref.id 与 file.id 不一致（"错误条目"）
       - 则删除当前 ref（保留正确条目）
    3. 写回 manifest

    安全保证:
    - 仅删除 manifest 中多余的 ref，不修改任何约束文件
    - 仅在确实存在"正确条目"时才删除重复，避免误删唯一引用
    - 不影响 schema / regex / transform 等其他类型

    参数:
        config_path: 项目配置根目录

    返回:
        StandardResponse: 操作结果消息（含删除数量）
    """
    manifest_path = _v2_manifest_path(config_path)

    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail="Manifest 文件不存在，请先保存项目")

    with project_lock(config_path):
        manifest = _read_manifest(manifest_path)
        if not manifest:
            raise HTTPException(status_code=404, detail="Manifest 文件无法解析")

        constraints = list(manifest.constraints or [])
        if not constraints:
            return {"message": "manifest 中无 constraint 引用，无需去重"}

        # 读取每个 constraint 文件，建立 {normalized_path -> file.id} 映射
        path_to_file_id: dict[str, str] = {}
        for ref in constraints:
            abs_path = os.path.normpath(os.path.join(config_path, ref.path))
            if abs_path in path_to_file_id:
                continue
            if not os.path.isfile(abs_path):
                continue
            try:
                from app.shared.core.project.constraint.reader import load_constraint

                file_obj = load_constraint(Path(abs_path))
                path_to_file_id[abs_path] = file_obj.id
            except Exception as e:
                logger.warning("[deduplicate_constraint_refs] 读取失败，跳过: %s, 错误: %s", abs_path, e)

        # 第一遍：标记哪些 (path, ref_id) 是"正确条目"（id 与 file id 匹配）
        correct_keys: set[tuple[str, str]] = set()
        for ref in constraints:
            abs_path = os.path.normpath(os.path.join(config_path, ref.path))
            file_id = path_to_file_id.get(abs_path)
            if file_id and file_id == ref.id:
                correct_keys.add((abs_path, ref.id))

        # 第二遍：删除不正确的重复 ref（仅当同 path 存在正确条目时）
        to_keep: list[ConstraintRef] = []
        removed: list[str] = []
        for ref in constraints:
            abs_path = os.path.normpath(os.path.join(config_path, ref.path))
            file_id = path_to_file_id.get(abs_path)
            is_correct = file_id == ref.id
            # 当前 ref.id 与 file id 不一致，且同 path 存在 ref.id == file id 的"正确条目"
            is_dup_with_correct = not is_correct and file_id is not None and (abs_path, file_id) in correct_keys
            if is_dup_with_correct:
                removed.append(ref.id)
                continue
            to_keep.append(ref)

        if removed:
            updated_manifest = manifest.model_copy(update={"constraints": to_keep})
            write_yaml_atomic(Path(manifest_path), updated_manifest.model_dump(exclude_none=True))
            logger.info(
                "[deduplicate_constraint_refs] 已删除 %d 个重复条目: %s",
                len(removed),
                removed,
            )

    return {"message": (f"已删除 {len(removed)} 个重复条目" if removed else "未发现可去重的重复条目")}
