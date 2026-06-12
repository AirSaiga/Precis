"""
@fileoverview 配置自检自动修复 API

功能概述:
- 提供自检发现问题的自动修复端点
- 支持表引用修正、列引用修正、正则引用修正、ID 不一致修正
- 所有修复操作使用文件锁保证并发安全

修复策略:
- 表/列引用修正: 直接修改约束/正则文件中的 refs 字段
- ID 不一致修正: 更新 manifest 中的引用 ID 为文件实际 ID
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_project_config_path
from app.shared.core.io.yaml import read_yaml, write_yaml_atomic

from .base import StandardResponse, _v2_manifest_path
from .helpers import project_lock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="", tags=["Project-Inspection-Fix"])


class FixTableRefRequest(BaseModel):
    constraint_id: str
    field: str
    old_table_id: str
    new_table_id: str


class FixColumnRefRequest(BaseModel):
    constraint_id: str
    field: str
    table_id: str
    old_column_id: str
    new_column_id: str


class FixRegexTableRefRequest(BaseModel):
    regex_id: str
    old_table_id: str
    new_table_id: str


class FixRegexColumnRefRequest(BaseModel):
    regex_id: str
    table_id: str
    old_column_id: str
    new_column_id: str


class FixIdMismatchRequest(BaseModel):
    resource_type: str
    manifest_id: str
    file_id: str


def _find_constraint_file(config_path: str, constraint_id: str) -> Path | None:
    """在 constraints/ 目录中查找指定 ID 的约束文件。"""
    constraints_dir = os.path.join(config_path, "constraints")
    if not os.path.isdir(constraints_dir):
        return None
    for filename in os.listdir(constraints_dir):
        if not filename.endswith((".yaml", ".yml")):
            continue
        file_path = Path(os.path.join(constraints_dir, filename))
        try:
            raw = read_yaml(file_path)
            if raw.get("id") == constraint_id:
                return file_path
        except Exception:
            continue
    return None


def _find_regex_file(config_path: str, regex_id: str) -> Path | None:
    """在 regex/ 目录中查找指定 ID 的正则文件。"""
    regex_dir = os.path.join(config_path, "regex")
    if not os.path.isdir(regex_dir):
        return None
    for filename in os.listdir(regex_dir):
        if not filename.endswith((".yaml", ".yml")):
            continue
        file_path = Path(os.path.join(regex_dir, filename))
        try:
            raw = read_yaml(file_path)
            if raw.get("id") == regex_id:
                return file_path
        except Exception:
            continue
    return None


def _find_file_by_id(config_path: str, resource_type: str, resource_id: str) -> Path | None:
    """根据资源类型和 ID 查找对应的文件。"""
    dir_map = {
        "schema": "schemas",
        "constraint": "constraints",
        "regex": "regex",
        "transform": "transforms",
    }
    subdir = dir_map.get(resource_type)
    if not subdir:
        return None
    target_dir = os.path.join(config_path, subdir)
    if not os.path.isdir(target_dir):
        return None
    for filename in os.listdir(target_dir):
        if not filename.endswith((".yaml", ".yml")):
            continue
        file_path = Path(os.path.join(target_dir, filename))
        try:
            raw = read_yaml(file_path)
            if raw.get("id") == resource_id:
                return file_path
        except Exception:
            continue
    return None


def _update_refs_field(refs: dict[str, Any], field: str, key: str, old_value: str, new_value: str) -> bool:
    """更新 refs 字典中指定 key 的值。"""
    if field.startswith("fk_src"):
        key_map = {"table_id": "from_table_id", "column_id": "from_column_id"}
        actual_key = key_map.get(key, key)
    elif field.startswith("fk_dst"):
        key_map = {"table_id": "to_table_id", "column_id": "to_column_id"}
        actual_key = key_map.get(key, key)
    else:
        actual_key = key

    if refs.get(actual_key) == old_value:
        refs[actual_key] = new_value
        return True
    return False


@router.post(
    "/inspection/fix-table-ref",
    response_model=StandardResponse,
    summary="修复约束中的表引用",
)
def fix_table_ref(
    req: FixTableRefRequest,
    config_path: str = Depends(get_project_config_path),
) -> dict:
    """将约束文件中引用的旧表 ID 替换为新表 ID。"""
    with project_lock(config_path):
        file_path = _find_constraint_file(config_path, req.constraint_id)
        if not file_path:
            raise HTTPException(status_code=404, detail=f"约束文件 '{req.constraint_id}' 未找到")

        raw = read_yaml(file_path)
        refs = raw.get("refs", {})
        updated = _update_refs_field(refs, req.field, "table_id", req.old_table_id, req.new_table_id)
        if not updated:
            raise HTTPException(status_code=400, detail="未找到匹配的旧表引用，可能已被修改")

        raw["refs"] = refs
        write_yaml_atomic(file_path, raw)
        logger.info("[fix_table_ref] %s: %s → %s", req.constraint_id, req.old_table_id, req.new_table_id)

    return {"message": f"已将表引用从 '{req.old_table_id}' 修正为 '{req.new_table_id}'"}


@router.post(
    "/inspection/fix-column-ref",
    response_model=StandardResponse,
    summary="修复约束中的列引用",
)
def fix_column_ref(
    req: FixColumnRefRequest,
    config_path: str = Depends(get_project_config_path),
) -> dict:
    """将约束文件中引用的旧列 ID 替换为新列 ID。"""
    with project_lock(config_path):
        file_path = _find_constraint_file(config_path, req.constraint_id)
        if not file_path:
            raise HTTPException(status_code=404, detail=f"约束文件 '{req.constraint_id}' 未找到")

        raw = read_yaml(file_path)
        refs = raw.get("refs", {})
        updated = _update_refs_field(refs, req.field, "column_id", req.old_column_id, req.new_column_id)

        if not updated:
            col_ids = refs.get("column_ids")
            if isinstance(col_ids, list) and req.old_column_id in col_ids:
                idx = col_ids.index(req.old_column_id)
                col_ids[idx] = req.new_column_id
                updated = True

        if not updated:
            raise HTTPException(status_code=400, detail="未找到匹配的旧列引用，可能已被修改")

        raw["refs"] = refs
        write_yaml_atomic(file_path, raw)
        logger.info(
            "[fix_column_ref] %s/%s: %s → %s", req.constraint_id, req.table_id, req.old_column_id, req.new_column_id
        )

    return {"message": f"已将列引用从 '{req.old_column_id}' 修正为 '{req.new_column_id}'"}


@router.post(
    "/inspection/fix-regex-table-ref",
    response_model=StandardResponse,
    summary="修复正则节点的表引用",
)
def fix_regex_table_ref(
    req: FixRegexTableRefRequest,
    config_path: str = Depends(get_project_config_path),
) -> dict:
    """将正则文件中 source_ref.table_id 替换为新表 ID。"""
    with project_lock(config_path):
        file_path = _find_regex_file(config_path, req.regex_id)
        if not file_path:
            raise HTTPException(status_code=404, detail=f"正则文件 '{req.regex_id}' 未找到")

        raw = read_yaml(file_path)
        source_ref = raw.get("source_ref", {})
        if source_ref.get("table_id") != req.old_table_id:
            raise HTTPException(status_code=400, detail="未找到匹配的旧表引用，可能已被修改")

        source_ref["table_id"] = req.new_table_id
        raw["source_ref"] = source_ref
        write_yaml_atomic(file_path, raw)
        logger.info("[fix_regex_table_ref] %s: %s → %s", req.regex_id, req.old_table_id, req.new_table_id)

    return {"message": f"已将正则表引用从 '{req.old_table_id}' 修正为 '{req.new_table_id}'"}


@router.post(
    "/inspection/fix-regex-column-ref",
    response_model=StandardResponse,
    summary="修复正则节点的列引用",
)
def fix_regex_column_ref(
    req: FixRegexColumnRefRequest,
    config_path: str = Depends(get_project_config_path),
) -> dict:
    """将正则文件中 source_ref.column_id 替换为新列 ID。"""
    with project_lock(config_path):
        file_path = _find_regex_file(config_path, req.regex_id)
        if not file_path:
            raise HTTPException(status_code=404, detail=f"正则文件 '{req.regex_id}' 未找到")

        raw = read_yaml(file_path)
        source_ref = raw.get("source_ref", {})
        if source_ref.get("column_id") != req.old_column_id:
            raise HTTPException(status_code=400, detail="未找到匹配的旧列引用，可能已被修改")

        source_ref["column_id"] = req.new_column_id
        raw["source_ref"] = source_ref
        write_yaml_atomic(file_path, raw)
        logger.info(
            "[fix_regex_column_ref] %s/%s: %s → %s", req.regex_id, req.table_id, req.old_column_id, req.new_column_id
        )

    return {"message": f"已将正则列引用从 '{req.old_column_id}' 修正为 '{req.new_column_id}'"}


@router.post(
    "/manifest/fix-id-mismatch",
    response_model=StandardResponse,
    summary="修复 manifest 中的 ID 不一致",
)
def fix_id_mismatch(
    req: FixIdMismatchRequest,
    config_path: str = Depends(get_project_config_path),
) -> dict:
    """将 manifest 中的旧引用 ID 更新为文件实际 ID。"""
    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail="Manifest 文件不存在")

    field_map = {
        "schema": "schemas",
        "constraint": "constraints",
        "regex": "regex_nodes",
        "transform": "transforms",
    }
    field_name = field_map.get(req.resource_type)
    if not field_name:
        raise HTTPException(status_code=400, detail=f"不支持的资源类型: {req.resource_type}")

    with project_lock(config_path):
        raw = read_yaml(Path(manifest_path))
        items = raw.get(field_name, [])
        found = False
        for item in items:
            if item.get("id") == req.manifest_id:
                item["id"] = req.file_id
                found = True
                break

        if not found:
            raise HTTPException(
                status_code=400, detail=f"未在 manifest 中找到 ID 为 '{req.manifest_id}' 的 {req.resource_type} 引用"
            )

        write_yaml_atomic(Path(manifest_path), raw)
        logger.info("[fix_id_mismatch] %s: %s → %s", req.resource_type, req.manifest_id, req.file_id)

    return {"message": f"已将 manifest 中 {req.resource_type} 引用从 '{req.manifest_id}' 更新为 '{req.file_id}'"}
