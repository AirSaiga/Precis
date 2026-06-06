"""
@fileoverview V2 全量配置写入模块

功能概述:
- 处理 V2 全量配置的写入逻辑
- Schema ID 自动迁移（根据 source.path 生成标准 ID）
- 合并策略：保留现有 manifest 中未覆盖的引用
- 从目录扫描补充缺失的资源引用

输入示例:
    result = write_v2_full_config(payload, config_path, manifest_path)

输出示例:
    {"message": "V2 全量配置已保存。"}
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from app.shared.core.io.yaml import read_yaml, write_yaml
from app.shared.core.project.manifest.types import ProjectManifestV2
from app.shared.core.project.regex.types import RegexNodeFileV2

from .base import (
    ConstraintFileV2,
    ConstraintRefV2,
    FullConfigV2Request,
    RegexNodeRefV2,
    SchemaRefV2,
    TableSchemaFileV2,
    TransformRefV2,
    _v2_manifest_path,
)
from .helpers import _resolve_project_path, project_lock

logger = logging.getLogger(__name__)


def _rewrite_table_ids_in_refs(refs: dict[str, Any], schema_id_migration: dict[str, str]) -> dict[str, Any]:
    """重写 refs 中的 table ID 引用。

    根据 schema_id_migration 映射表，将 refs 中的旧 table_id 替换为新 ID。

    Args:
        refs: 包含 table_id/from_table_id/to_table_id 的字典
        schema_id_migration: 旧 ID 到新 ID 的映射

    Returns:
        重写后的 refs 字典
    """
    for k in ["table_id", "from_table_id", "to_table_id"]:
        v = refs.get(k)
        if isinstance(v, str) and v in schema_id_migration:
            refs[k] = schema_id_migration[v]
    return refs


def _migrate_schema_ids(
    payload: FullConfigV2Request,
) -> tuple[FullConfigV2Request, dict[str, str]]:
    """迁移 schema ID。

    根据 source.path 生成标准 ID（以 sc_ 开头），并更新所有引用。

    Args:
        payload: 全量配置请求

    Returns:
        (更新后的 payload, schema_id_migration 映射)
    """
    schema_id_migration: dict[str, str] = {}
    migrated_schemas: dict[str, TableSchemaFileV2] = {}
    for key, schema in (payload.schemas or {}).items():
        current_id = schema.id or key
        src = schema.source
        src_path = src.path if src else ""
        sheet_name = (src.sheet if src else None) or getattr(schema, "sheet", None)
        if src_path and not current_id.startswith("sc_"):
            from app.shared.core.project.schema.types import generate_schema_id

            new_id = generate_schema_id(src_path, sheet_name)
            if new_id and new_id != current_id:
                schema_id_migration[current_id] = new_id
                schema = schema.model_copy(update={"id": new_id})
                migrated_schemas[new_id] = schema
                continue
        migrated_schemas[current_id] = schema

    if not schema_id_migration:
        return payload, {}

    payload = payload.model_copy(update={"schemas": migrated_schemas})
    migrated_schema_refs: list[SchemaRefV2] = []
    for ref in payload.manifest.schemas:
        new_id = schema_id_migration.get(ref.id, ref.id)
        new_path = ref.path
        if new_id != ref.id:
            new_path = f"schemas/{new_id}.schema.yaml"
        migrated_schema_refs.append(SchemaRefV2(id=new_id, path=new_path))
    payload = payload.model_copy(
        update={"manifest": payload.manifest.model_copy(update={"schemas": migrated_schema_refs})}
    )

    # 重写 schemas/constraints/regex_nodes 中的 table_id 引用
    rewritten_schemas: dict[str, TableSchemaFileV2] = {}
    for sid, s in (payload.schemas or {}).items():
        s_data = s.model_dump(exclude_none=True)
        constraints = s_data.get("constraints") or []
        if isinstance(constraints, list):
            for c in constraints:
                if isinstance(c, dict) and isinstance(c.get("refs"), dict):
                    c["refs"] = _rewrite_table_ids_in_refs(c["refs"], schema_id_migration)
        rewritten_schemas[sid] = TableSchemaFileV2.model_validate(s_data)

    migrated_constraints: dict[str, ConstraintFileV2] = {}
    for cid, c in (payload.constraints or {}).items():
        data = c.model_dump(exclude_none=True)
        refs = data.get("refs") or {}
        if isinstance(refs, dict):
            data["refs"] = _rewrite_table_ids_in_refs(refs, schema_id_migration)
        migrated_constraints[cid] = ConstraintFileV2.model_validate(data)

    migrated_regex_nodes: dict[str, RegexNodeFileV2] = {}
    for rid, r in (payload.regex_nodes or {}).items():
        data = r.model_dump(exclude_none=True)
        src_ref = data.get("source_ref") or {}
        if isinstance(src_ref, dict):
            table_id = src_ref.get("table_id")
            if isinstance(table_id, str) and table_id in schema_id_migration:
                src_ref["table_id"] = schema_id_migration[table_id]
            data["source_ref"] = src_ref
        migrated_regex_nodes[rid] = RegexNodeFileV2.model_validate(data)

    payload = payload.model_copy(
        update={
            "schemas": rewritten_schemas,
            "constraints": migrated_constraints,
            "regex_nodes": migrated_regex_nodes,
        }
    )

    return payload, schema_id_migration


def _merge_manifest_references(
    payload: FullConfigV2Request,
    existing_manifest: ProjectManifestV2 | None,
    config_path: str,
) -> ProjectManifestV2:
    """合并 manifest 引用。

    如果 payload 中的某类资源为空，保留现有 manifest 中的同类引用。
    同时从目录扫描补充缺失的资源引用。

    Args:
        payload: 全量配置请求
        existing_manifest: 现有 manifest（可能为 None）
        config_path: 项目配置根目录

    Returns:
        合并后的最终 manifest
    """
    final_manifest = payload.manifest

    if not payload.manifest.schemas and existing_manifest and existing_manifest.schemas:
        logger.info(f"[put_v2_full_config] 合并现有 schemas: {len(existing_manifest.schemas)} 个")
        final_manifest = payload.manifest.model_copy(update={"schemas": existing_manifest.schemas})

    if not payload.manifest.constraints and existing_manifest and existing_manifest.constraints:
        final_manifest = final_manifest.model_copy(update={"constraints": existing_manifest.constraints})

    if not (payload.manifest.regex_nodes or []) and existing_manifest and existing_manifest.regex_nodes:
        final_manifest = final_manifest.model_copy(update={"regex_nodes": existing_manifest.regex_nodes})

    if not (payload.manifest.transforms or []) and existing_manifest and existing_manifest.transforms:
        final_manifest = final_manifest.model_copy(update={"transforms": existing_manifest.transforms})

    if not final_manifest.schemas:
        schemas_dir = os.path.join(config_path, "schemas")
        if os.path.isdir(schemas_dir):
            schema_refs = []
            for filename in os.listdir(schemas_dir):
                if filename.endswith(".schema.yaml"):
                    schema_id = filename[:-12]
                    schema_refs.append(SchemaRefV2(id=schema_id, path=f"schemas/{filename}"))
            if schema_refs:
                logger.info(f"[put_v2_full_config] 从 schemas/ 目录扫描到 {len(schema_refs)} 个 schema 文件")
                final_manifest = final_manifest.model_copy(update={"schemas": schema_refs})

    if not final_manifest.constraints:
        constraints_dir = os.path.join(config_path, "constraints")
        if os.path.isdir(constraints_dir):
            constraint_refs = []
            for filename in os.listdir(constraints_dir):
                if filename.endswith(".constraint.yaml"):
                    constraint_id = filename[:-16]
                    constraint_refs.append(ConstraintRefV2(id=constraint_id, path=f"constraints/{filename}"))
            if constraint_refs:
                logger.info(
                    f"[put_v2_full_config] 从 constraints/ 目录扫描到 {len(constraint_refs)} 个 constraint 文件"
                )
                final_manifest = final_manifest.model_copy(update={"constraints": constraint_refs})

    if not (final_manifest.regex_nodes or []):
        regex_dirs = [os.path.join(config_path, "regex"), os.path.join(config_path, "regex_nodes")]
        seen_regex_ids = set()
        regex_refs: list[RegexNodeRefV2] = []
        for d in regex_dirs:
            if not os.path.isdir(d):
                continue
            for filename in os.listdir(d):
                if filename.endswith(".regex.yaml"):
                    regex_id = filename[:-10]
                    if regex_id in seen_regex_ids:
                        continue
                    rel_dir = os.path.basename(d)
                    regex_refs.append(RegexNodeRefV2(id=regex_id, path=f"{rel_dir}/{filename}"))
                    seen_regex_ids.add(regex_id)
        if regex_refs:
            logger.info(f"[put_v2_full_config] 从 regex/ 目录扫描到 {len(regex_refs)} 个 regex 文件")
            final_manifest = final_manifest.model_copy(update={"regex_nodes": regex_refs})

    if not (final_manifest.transforms or []):
        transforms_dir = os.path.join(config_path, "transforms")
        if os.path.isdir(transforms_dir):
            transform_refs = []
            for filename in os.listdir(transforms_dir):
                if filename.endswith(".transform.yaml"):
                    transform_id = filename[:-15]
                    transform_refs.append(TransformRefV2(id=transform_id, path=f"transforms/{filename}"))
            if transform_refs:
                logger.info(f"[put_v2_full_config] 从 transforms/ 目录扫描到 {len(transform_refs)} 个 transform 文件")
                final_manifest = final_manifest.model_copy(update={"transforms": transform_refs})

    return final_manifest


def _write_resource_files(
    payload: FullConfigV2Request,
    config_path: str,
) -> None:
    """写入资源文件。

    将 payload 中的 schemas、constraints、regex_nodes 写入对应的文件。

    Args:
        payload: 全量配置请求
        config_path: 项目配置根目录
    """
    for ref in payload.manifest.schemas:
        schema = payload.schemas.get(ref.id)
        if not schema:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Schema 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), schema.model_dump(exclude_none=True))

    for ref in payload.manifest.constraints:
        constraint = payload.constraints.get(ref.id)
        if not constraint:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Constraint 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), constraint.model_dump(exclude_none=True))

    for ref in payload.manifest.regex_nodes:
        regex_node = payload.regex_nodes.get(ref.id)
        if not regex_node:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Regex 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), regex_node.model_dump(exclude_none=True))

    for ref in payload.manifest.transforms or []:
        transform = payload.transforms.get(ref.id)
        if not transform:
            continue
        try:
            abs_path = _resolve_project_path(config_path, ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Transform 路径: {ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), transform.model_dump(exclude_none=True))


def write_v2_full_config(
    payload: FullConfigV2Request,
    config_path: str,
) -> dict[str, str]:
    """写入 V2 全量配置。

    会覆盖写入 manifest 与其引用的文件。

    Args:
        payload: 包含 manifest 和所有资源配置的请求
        config_path: 项目配置根目录

    Returns:
        操作结果消息字典
    """
    manifest_path = _v2_manifest_path(config_path)

    existing_manifest = None
    if os.path.isfile(manifest_path):
        try:
            existing_manifest = ProjectManifestV2.model_validate(read_yaml(Path(manifest_path)))
            logger.info("[put_v2_full_config] 读取现有 manifest 成功")
        except Exception as e:
            logger.warning(f"[put_v2_full_config] 读取现有 manifest 失败: {e}")

    # Step 1: Schema ID 迁移
    payload, _ = _migrate_schema_ids(payload)

    # Step 2: 合并 manifest 引用
    final_manifest = _merge_manifest_references(payload, existing_manifest, config_path)

    # Step 3: 写入 manifest
    with project_lock(config_path):
        write_yaml(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
    logger.info(f"[put_v2_full_config] 写入 manifest 完成，schemas: {len(final_manifest.schemas)} 个")

    # Step 4: 写入资源文件
    _write_resource_files(payload, config_path)

    return {"message": "V2 全量配置已保存。"}
