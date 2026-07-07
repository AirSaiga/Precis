"""
@fileoverview V2 全量配置写入模块

功能概述:
- 处理 V2 全量配置的写入逻辑
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

from app.shared.core.io.yaml import read_yaml, write_yaml
from app.shared.core.project.manifest.types import ManualDataRefV2, ProjectManifestV2

from .base import (
    ConstraintRefV2,
    FullConfigV2Request,
    RegexNodeRefV2,
    SchemaRefV2,
    TransformRefV2,
    _v2_manifest_path,
)
from .helpers import _resolve_project_path, project_lock

logger = logging.getLogger(__name__)


def _merge_manifest_references(
    payload: FullConfigV2Request,
    existing_manifest: ProjectManifestV2 | None,
    config_path: str,
) -> ProjectManifestV2:
    """合并 manifest 引用。

    合并策略：对于客户端**未显式设置**的资源字段，保留现有 manifest 中的同类引用；
    对于显式设置的字段（即使设为空列表 []），遵从客户端意图（允许清空）。
    通过 model_fields_set 区分"未提供"与"显式置空"。

    Args:
        payload: 全量配置请求
        existing_manifest: 现有 manifest（可能为 None）
        config_path: 项目配置根目录

    Returns:
        合并后的最终 manifest
    """
    final_manifest = payload.manifest
    # 客户端显式设置的字段集合（区分"未提供"与"显式置空 []"）
    set_fields = payload.manifest.model_fields_set

    def _should_merge(field: str) -> bool:
        """字段未被客户端显式设置，且现有 manifest 有值时才合并。"""
        return field not in set_fields and existing_manifest is not None and bool(getattr(existing_manifest, field))

    # mypy 无法从 _should_merge 的返回值推断 existing_manifest 非 None，
    # 用 existing 局部变量（仅在 existing_manifest 非 None 时赋值）帮助类型收窄。
    existing: ProjectManifestV2 | None = existing_manifest

    if _should_merge("schemas") and existing is not None:
        logger.info(f"[put_v2_full_config] 合并现有 schemas: {len(existing.schemas)} 个")
        final_manifest = final_manifest.model_copy(update={"schemas": existing.schemas})

    if _should_merge("constraints") and existing is not None:
        final_manifest = final_manifest.model_copy(update={"constraints": existing.constraints})

    if _should_merge("regex_nodes") and existing is not None:
        final_manifest = final_manifest.model_copy(update={"regex_nodes": existing.regex_nodes})

    if _should_merge("transforms") and existing is not None:
        final_manifest = final_manifest.model_copy(update={"transforms": existing.transforms})

    if _should_merge("manual_data") and existing is not None:
        final_manifest = final_manifest.model_copy(update={"manual_data": existing.manual_data})

    if _should_merge("data_sources") and existing is not None:
        final_manifest = final_manifest.model_copy(update={"data_sources": existing.data_sources})

    # 目录扫描补充：仅对客户端"未显式设置"且当前为空的字段从磁盘发现文件，
    # 显式置空 [] 的字段不会被目录扫描覆盖（尊重用户清空意图）
    def _should_scan(field: str) -> bool:
        return field not in set_fields and not bool(getattr(final_manifest, field))

    if _should_scan("schemas"):
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

    if _should_scan("constraints"):
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

    if _should_scan("regex_nodes"):
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

    if _should_scan("transforms"):
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

    if _should_scan("manual_data"):
        manual_data_dir = os.path.join(config_path, "manual_data")
        if os.path.isdir(manual_data_dir):
            manual_data_refs = []
            for filename in os.listdir(manual_data_dir):
                if filename.endswith(".manual_data.yaml"):
                    manual_data_id = filename[: -len(".manual_data.yaml")]
                    manual_data_refs.append(ManualDataRefV2(id=manual_data_id, path=f"manual_data/{filename}"))
            if manual_data_refs:
                logger.info(
                    f"[put_v2_full_config] 从 manual_data/ 目录扫描到 {len(manual_data_refs)} 个 manual_data 文件"
                )
                final_manifest = final_manifest.model_copy(update={"manual_data": manual_data_refs})

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
    for schema_ref in payload.manifest.schemas:
        schema = payload.schemas.get(schema_ref.id)
        if not schema:
            continue
        try:
            abs_path = _resolve_project_path(config_path, schema_ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Schema 路径: {schema_ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), schema.model_dump(exclude_none=True))

    for constraint_ref in payload.manifest.constraints:
        constraint = payload.constraints.get(constraint_ref.id)
        if not constraint:
            continue
        try:
            abs_path = _resolve_project_path(config_path, constraint_ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Constraint 路径: {constraint_ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), constraint.model_dump(exclude_none=True))

    for regex_ref in payload.manifest.regex_nodes:
        regex_node = payload.regex_nodes.get(regex_ref.id)
        if not regex_node:
            continue
        try:
            abs_path = _resolve_project_path(config_path, regex_ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Regex 路径: {regex_ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), regex_node.model_dump(exclude_none=True))

    for transform_ref in payload.manifest.transforms or []:
        transform = payload.transforms.get(transform_ref.id)
        if not transform:
            continue
        try:
            abs_path = _resolve_project_path(config_path, transform_ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 Transform 路径: {transform_ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), transform.model_dump(exclude_none=True))

    for manual_data_ref in payload.manifest.manual_data or []:
        manual_data = payload.manual_data.get(manual_data_ref.id)
        if not manual_data:
            continue
        try:
            abs_path = _resolve_project_path(config_path, manual_data_ref.path)
        except ValueError as e:
            logger.error(f"[put_v2_full_config] 非法 ManualData 路径: {manual_data_ref.path}, 错误: {e}")
            continue
        write_yaml(Path(abs_path), manual_data.model_dump(exclude_none=True))


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

    # Step 1: 合并 manifest 引用
    final_manifest = _merge_manifest_references(payload, existing_manifest, config_path)

    # Step 2: 写入 manifest 与资源文件（在同一锁内保证一致性）
    with project_lock(config_path):
        write_yaml(Path(manifest_path), final_manifest.model_dump(exclude_none=True))
        logger.info(f"[put_v2_full_config] 写入 manifest 完成，schemas: {len(final_manifest.schemas)} 个")

        # Step 3: 写入资源文件
        _write_resource_files(payload, config_path)

    return {"message": "V2 全量配置已保存。"}
