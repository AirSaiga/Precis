# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview 配置自检自动修复 API

功能概述:
- 提供自检发现问题的自动修复端点
- 支持表引用修正、列引用修正、正则引用修正、ID 不一致修正
- 支持把磁盘已存在但未入清单的资源"收养"登记进 manifest（adopt-unlisted）
- 所有修复操作使用文件锁保证并发安全

修复策略:
- 表/列引用修正: 直接修改约束/正则文件中的 refs 字段
- ID 不一致修正: 更新 manifest 中的引用 ID 为文件实际 ID
- 收养登记: 在 manifest 中追加引用（id/path 取文件实际值，幂等）
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
from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.writer import (
    ensure_constraint_ref,
    ensure_manual_data_ref,
    ensure_regex_ref,
    ensure_schema_ref,
    ensure_transform_ref,
    save_manifest,
)

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


class AdoptUnlistedRequest(BaseModel):
    """收养孤儿资源的请求体：按 id 或相对路径定位磁盘上已存在但未入清单的资源。"""

    resource_type: str  # schema / constraint / regex / transform / manual_data
    resource_id: str | None = None
    resource_path: str | None = None


class AdoptUnlistedResponse(BaseModel):
    """收养结果：already_listed=True 表示资源本就已登记（幂等语义）。"""

    message: str
    already_listed: bool
    resource_id: str


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


# 收养资源类型 → 磁盘子目录映射（与 compute_manifest_coverage 的扫描口径一致）
_ADOPT_DIR_MAP = {
    "schema": "schemas",
    "constraint": "constraints",
    "regex": "regex",
    "transform": "transforms",
    "manual_data": "manual_data",
}

# 资源文件命名后缀（长后缀在前，避免 .yaml 提前截断）
_RESOURCE_SUFFIXES = (
    ".schema.yaml",
    ".constraint.yaml",
    ".regex.yaml",
    ".transform.yaml",
    ".manual_data.yaml",
    ".yaml",
    ".yml",
)


def _stem_resource_id(filename: str) -> str:
    """按资源命名规范从文件名推导资源 id（去掉类型后缀）。"""
    lower = filename.lower()
    for suffix in _RESOURCE_SUFFIXES:
        if lower.endswith(suffix):
            return filename[: -len(suffix)]
    return filename


def _find_resource_file(config_path: str, req: AdoptUnlistedRequest) -> Path:
    """按 path 或 id 定位磁盘上的资源文件。

    路径必须相对项目根且不允许穿越（可写操作从严）；按 id 查找时先匹配文件
    内容 id，再兜底匹配文件名推导 id（内容不可解析的坏文件也可收养）。

    异常:
        HTTPException 400（输入非法）/ 404（文件不存在）
    """
    if req.resource_path:
        raw = req.resource_path.replace("\\", "/")
        if not raw or os.path.isabs(raw) or ".." in raw.split("/"):
            raise HTTPException(status_code=400, detail=f"非法的资源路径: {req.resource_path}")
        candidate = Path(os.path.join(config_path, *raw.split("/")))
        if not candidate.is_file():
            raise HTTPException(status_code=404, detail=f"资源文件不存在: {req.resource_path}")
        return candidate

    # 按 id 定位（resource_path 未提供）
    target_dir = os.path.join(config_path, _ADOPT_DIR_MAP[req.resource_type])
    if not os.path.isdir(target_dir):
        raise HTTPException(
            status_code=404, detail=f"未找到 {req.resource_type} '{req.resource_id}'（目录 {target_dir} 不存在）"
        )
    fallback_by_stem: Path | None = None
    for filename in sorted(os.listdir(target_dir)):
        if not filename.endswith((".yaml", ".yml")):
            continue
        file_path = Path(os.path.join(target_dir, filename))
        if _stem_resource_id(filename) == req.resource_id:
            fallback_by_stem = fallback_by_stem or file_path
        try:
            file_data = read_yaml(file_path)
        except Exception:
            continue
        if isinstance(file_data, dict) and file_data.get("id") == req.resource_id:
            return file_path
    if fallback_by_stem is not None:
        return fallback_by_stem
    raise HTTPException(status_code=404, detail=f"未找到 {req.resource_type} '{req.resource_id}' 对应的文件")


def _manifest_refs_for_type(manifest: Any, resource_type: str) -> list[Any]:
    """取 manifest 中指定资源类型的引用列表（带 id/path 属性的对象）。"""
    field_map = {
        "schema": manifest.schemas,
        "constraint": manifest.constraints,
        "regex": manifest.regex_nodes,
        "transform": manifest.transforms,
        "manual_data": manifest.manual_data,
    }
    return list(field_map[resource_type])


def _ensure_ref_for_type(manifest: Any, resource_type: str, resource_id: str, rel_path: str) -> None:
    """把资源引用登记进 manifest 对象（由调用方统一 save_manifest 落盘）。"""
    ensure_map = {
        "schema": ensure_schema_ref,
        "constraint": ensure_constraint_ref,
        "regex": ensure_regex_ref,
        "transform": ensure_transform_ref,
        "manual_data": ensure_manual_data_ref,
    }
    ensure_map[resource_type](manifest, resource_id, rel_path)


@router.post(
    "/inspection/adopt-unlisted",
    response_model=AdoptUnlistedResponse,
    summary="把磁盘已存在但未入清单的资源登记进项目清单",
)
def adopt_unlisted(
    req: AdoptUnlistedRequest,
    config_path: str = Depends(get_project_config_path),
) -> dict:
    """收养孤儿资源：把磁盘上已存在但未登记进 project.precis.yaml 的资源登记进清单。

    幂等：资源已登记（按 id 或路径命中）时返回 200 + already_listed=True，不重复追加。
    登记引用的 id/path 均取文件实际值（孤儿文件名可能与 id 不同）。
    """
    if req.resource_type not in _ADOPT_DIR_MAP:
        raise HTTPException(status_code=400, detail=f"不支持的资源类型: {req.resource_type}")
    if not req.resource_id and not req.resource_path:
        raise HTTPException(status_code=400, detail="需要提供 resource_id 或 resource_path 之一")

    manifest_path = _v2_manifest_path(config_path)
    if not os.path.isfile(manifest_path):
        raise HTTPException(status_code=404, detail="项目配置文件不存在，请先保存项目")

    with project_lock(config_path):
        file_path = _find_resource_file(config_path, req)

        # 登记引用取文件实际 id（内容 id 优先，坏文件回退文件名推导）
        actual_id = ""
        try:
            raw = read_yaml(file_path)
            if isinstance(raw, dict) and raw.get("id"):
                actual_id = str(raw["id"])
        except Exception as e:
            logger.warning("[adopt_unlisted] 读取资源文件失败，id 回退文件名推导: %s -> %s", file_path, e)
        if not actual_id:
            actual_id = _stem_resource_id(file_path.name)

        rel_path = os.path.relpath(file_path, config_path).replace("\\", "/")
        normalized = rel_path.lower()

        manifest = load_manifest(Path(manifest_path))
        # 幂等判定：按 id 或按归一化路径，任一命中即视为已登记
        for ref in _manifest_refs_for_type(manifest, req.resource_type):
            if ref.id == actual_id or (ref.path or "").replace("\\", "/").lower() == normalized:
                logger.info("[adopt_unlisted] %s '%s' 已在清单中（幂等跳过）", req.resource_type, actual_id)
                return {
                    "message": f"{req.resource_type} '{actual_id}' 已在项目清单中，无需重复登记",
                    "already_listed": True,
                    "resource_id": actual_id,
                }

        _ensure_ref_for_type(manifest, req.resource_type, actual_id, rel_path)
        save_manifest(manifest, Path(manifest_path))
        logger.info("[adopt_unlisted] 已登记 %s '%s' -> %s", req.resource_type, actual_id, rel_path)

    return {
        "message": f"已把 {req.resource_type} '{actual_id}' 登记进项目清单（{rel_path}）",
        "already_listed": False,
        "resource_id": actual_id,
    }


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
        raise HTTPException(status_code=404, detail="项目配置文件不存在，请先保存项目")

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
