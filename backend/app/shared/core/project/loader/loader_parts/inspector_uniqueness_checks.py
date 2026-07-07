"""Schema 唯一性检查模块。

检测两类 blocker 级冲突：
1. 多个 schema 文件使用同一 ID（SchemaIdDuplicate）
2. 多个 schema 指向同一数据源（SchemaSourceDuplicate）

本模块不依赖 inspector_helpers，独立性最高（内联构造 actions）。

依赖：→ inspection_ids + LoadingError
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

from app.shared.core.project.loader.loader_parts import inspection_ids as ids
from app.shared.core.project.loader.types import LoadingError

if TYPE_CHECKING:
    from app.shared.core.project.manifest.types import ProjectManifest
    from app.shared.core.project.schema.types import TableSchemaFile


def _report_schema_id_duplicates(
    id_to_refs: dict[str, list[str]],
    loading_errors: list[LoadingError],
) -> None:
    """根据 id → refs 索引上报重复 id 的 blocker 错误。

    被 inspect_schema_id_orphan_conflict 调用，基于磁盘扫描结果上报。
    """
    for sid, ref_keys in id_to_refs.items():
        count = len(ref_keys)
        if count > 1:
            primary_ref = ref_keys[0]
            loading_errors.append(
                LoadingError(
                    id=ids.schema_id_duplicate(sid),
                    severity="blocker",
                    title=f"有表重名了：{sid}",
                    description=f"Schema ID '{sid}' 被 {count} 个 schema 配置使用，可能导致约束引用指向错误的表。请确保每个 schema ID 唯一。",
                    fix_hint=f"请为重复的 schema 重新命名 ID（当前: {sid}），使其在项目内唯一。",
                    error_type="SchemaIdDuplicate",
                    file_path="",
                    ref_id=sid,
                    message="",
                    suggestion="修改其中一个 schema 文件的 id 字段，使其与其他 schema 不同",
                    actions=[
                        # 导航到画布中第一个重复 schema 节点，便于用户定位修改
                        {
                            "type": "navigate",
                            "label": "定位到节点",
                            "label_key": "inspection.actions.navigateToNode",
                            "target": primary_ref,
                        },
                        # 复制重复 ID，便于排查
                        {
                            "type": "copy",
                            "label": "复制 ID",
                            "label_key": "inspection.actions.copyId",
                            "text": sid,
                        },
                        # 允许忽略（此类问题需用户手动决策保留哪个，无法自动修复）
                        {
                            "type": "dismiss",
                            "label": "忽略",
                            "label_key": "inspection.actions.dismiss",
                        },
                    ],
                    title_key="inspection.issues.schemaIdDuplicate.title",
                    description_key="inspection.issues.schemaIdDuplicate.description",
                    fix_hint_key="inspection.issues.schemaIdDuplicate.fixHint",
                    message_params={"schemaId": sid, "count": count},
                )
            )


def inspect_schema_id_orphan_conflict(
    config_path: Path,
    manifest: ProjectManifest,
    schema_files: dict[str, TableSchemaFile],
    loading_errors: list[LoadingError],
) -> None:
    """检测磁盘上多个 schema 文件使用同一 ID（blocker）。

    本函数是 schema ID 唯一性检测的唯一入口。直接扫磁盘所有 .schema.yaml 文件，
    按「文件内 id」建索引，同一 id 被 ≥2 个文件使用即报 blocker。

    旧实现遍历 schema_files dict，但该 dict 按 id 做 key，冲突时后者会被吞掉，
    永远检测不到重复。基于磁盘的检测不依赖 manifest 白名单，因此在两条路径下
    都生效：
    - load_project（运行时校验，schema_files 只含 manifest 白名单文件）
    - get_v2_full_config（前端资源树，schema_files 含 effective_manifest 合并的孤儿）

    参数:
        config_path: 项目根目录（manifest 所在目录）
        manifest: 项目清单（保留参数，当前实现基于磁盘扫描，不依赖白名单）
        schema_files: 已加载的 schema dict（保留参数，兼容 inspect_config 调用签名）
        loading_errors: 错误收集列表（会被修改）
    """
    schemas_dir = config_path / "schemas"
    if not schemas_dir.is_dir():
        return

    from app.shared.core.io.yaml import read_yaml

    # 扫磁盘所有 .schema.yaml，按「文件内 id」索引到文件路径
    id_to_paths: dict[str, list[str]] = {}
    for filename in os.listdir(schemas_dir):
        if not filename.lower().endswith(".schema.yaml"):
            continue
        abs_path = schemas_dir / filename
        try:
            raw = read_yaml(abs_path)
        except Exception:
            continue
        if not isinstance(raw, dict):
            continue
        file_id = raw.get("id")
        if not isinstance(file_id, str) or not file_id.strip():
            continue
        id_to_paths.setdefault(file_id.strip(), []).append(f"schemas/{filename}")

    # 同一 id 被 ≥2 个文件使用 → 冲突
    conflict_index = {sid: paths for sid, paths in id_to_paths.items() if len(paths) > 1}

    if conflict_index:
        _report_schema_id_duplicates(conflict_index, loading_errors)


def inspect_source_uniqueness(
    schema_files: dict[str, TableSchemaFile],
    loading_errors: list[LoadingError],
) -> None:
    """检测两个 schema 指向同一数据源（blocker）。

    遍历所有 schema 的 source.path + source.sheet，标准化后构建索引。
    如果同一 source 被多个 schema 引用，记录 blocker 级错误。
    """
    from app.shared.core.project.schema.types_parts.schema_id import normalize_source_key

    source_map: dict[tuple[str, str | None], list[str]] = {}
    for sid, sdoc in schema_files.items():
        source = getattr(sdoc, "source", None)
        if source is None:
            continue
        path = getattr(source, "path", None) or ""
        sheet = getattr(source, "sheet", None)
        if not path:
            continue
        key = normalize_source_key(path, sheet)
        source_map.setdefault(key, []).append(sid)

    for key, sids in source_map.items():
        if len(sids) > 1:
            path_str, sheet_str = key
            source_display = f"{path_str}"
            if sheet_str:
                source_display += f" ({sheet_str})"
            primary_ref = sids[0]
            loading_errors.append(
                LoadingError(
                    id=ids.schema_source_duplicate(path_str, sheet_str),
                    severity="blocker",
                    title=f"有表指向了同一个数据文件：{source_display}",
                    description=f"数据源 '{source_display}' 被 {len(sids)} 个 schema 引用: {', '.join(sids)}。每个数据源只能被一个 schema 定义。请删除重复的 schema 或修改其 source.path。",
                    fix_hint=f"请保留其中一个 schema（如 {sids[0]}），删除或修改其他的。",
                    error_type="SchemaSourceDuplicate",
                    file_path="",
                    ref_id=primary_ref,
                    message="",
                    suggestion=f"保留 schema '{sids[0]}'，删除或修改: {', '.join(sids[1:])}",
                    actions=[
                        # 导航到第一个重复 schema 节点
                        {
                            "type": "navigate",
                            "label": "定位到节点",
                            "label_key": "inspection.actions.navigateToNode",
                            "target": primary_ref,
                        },
                        # 复制数据源路径，便于排查
                        {
                            "type": "copy",
                            "label": "复制数据源",
                            "label_key": "inspection.actions.copyFilePath",
                            "text": source_display,
                        },
                        # 允许忽略（需用户手动决策保留哪个 schema）
                        {
                            "type": "dismiss",
                            "label": "忽略",
                            "label_key": "inspection.actions.dismiss",
                        },
                    ],
                    title_key="inspection.issues.sourceDuplicate.title",
                    description_key="inspection.issues.sourceDuplicate.description",
                    fix_hint_key="inspection.issues.sourceDuplicate.fixHint",
                    message_params={
                        "sourceDisplay": source_display,
                        "count": len(sids),
                        "schemas": ", ".join(sids),
                        "primarySchema": primary_ref,
                    },
                )
            )
