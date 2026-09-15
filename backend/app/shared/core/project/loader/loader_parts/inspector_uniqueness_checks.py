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


def _schema_entity_label(path: str, name: str | None, schema_id: str) -> str:
    """生成 schema 实体的用户可读显示名：优先文件名 basename，扫描时已解析出表名则附上。

    表名与 id/basename 完全相同时不重复附加（如 id=name=users 的常见配置），避免噪音。
    """
    label = Path(path).name if path else ""
    cleaned = (name or "").strip()
    if cleaned and cleaned != schema_id and cleaned != label:
        label = f"{label}（{cleaned}）" if label else cleaned
    return label


def _schema_involved_entity(schema_id: str, path: str, name: str | None, navigable: bool) -> dict:
    """构造 context.involved 实体条目（前后端契约，镜像前端 InspectionInvolvedEntity）。

    唯一性冲突的实体固定标注 role='conflicting'（冲突方）。字段说明:
        - kind: 实体类型（当前仅 schema）
        - id: 实体 id（schema id）
        - path: 相对配置文件路径（未知时为空串，前端据此隐藏"打开文件"）
        - label: 用户可读显示名（优先文件名 basename）
        - navigable: 画布节点可否按 id 唯一寻址（id 冲突时为 False，
          前端不渲染"定位到节点"，因为同 id 节点无法区分）
    """
    return {
        "kind": "schema",
        "id": schema_id,
        "path": path,
        "label": _schema_entity_label(path, name, schema_id),
        "navigable": navigable,
        "role": "conflicting",
    }


def _report_schema_id_duplicates(
    id_to_refs: dict[str, list[tuple[str, str]]],
    loading_errors: list[LoadingError],
) -> None:
    """根据 id → refs 索引上报重复 id 的 blocker 错误。

    被 inspect_schema_id_orphan_conflict 调用，基于磁盘扫描结果上报。
    ref_keys 为 (相对文件路径, 文件内表名) 元组列表（schemas/xxx.schema.yaml）。
    """
    for sid, ref_keys in id_to_refs.items():
        count = len(ref_keys)
        if count > 1:
            primary_ref = ref_keys[0][0]
            # 结构化涉事实体清单：列出全部冲突文件（id 冲突，画布节点无法按 id 区分 → 不可导航）
            involved = [_schema_involved_entity(sid, path, name, False) for path, name in ref_keys]
            loading_errors.append(
                LoadingError(
                    id=ids.schema_id_duplicate(sid),
                    severity="blocker",
                    title=f"表 ID「{sid}」重复",
                    description=(
                        f"表 ID「{sid}」被 {count} 个 schema 文件同时使用。"
                        f"约束按 ID 引用表，ID 重复会导致约束引用指向错误的表。"
                        f"请确保每个 schema 的 id 字段唯一。"
                    ),
                    fix_hint=f"请打开下方任一冲突文件，把其中一个 schema 的 id 字段改为新的唯一值（当前均为「{sid}」）。",
                    error_type="SchemaIdDuplicate",
                    # 归属到第一个冲突 schema 文件，前端"按文件"分组可见
                    file_path=primary_ref,
                    ref_id=sid,
                    message="",
                    suggestion="修改其中一个 schema 文件的 id 字段，使其与其他 schema 不同",
                    context={"involved": involved},
                    actions=[
                        # 导航到画布中第一个重复 schema 节点，便于用户定位修改
                        # （画布节点以 schema id 为节点 id，target 必须是 sid 而非文件路径）
                        {
                            "type": "navigate",
                            "label": "定位到节点",
                            "label_key": "inspection.actions.navigateToNode",
                            "target": sid,
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

    # 扫磁盘所有 .schema.yaml，按「文件内 id」索引到 (相对路径, 文件内表名)
    # 表名一并收集，用于构造 involved 实体的友好显示名
    id_to_refs: dict[str, list[tuple[str, str]]] = {}
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
        file_name = raw.get("name")
        id_to_refs.setdefault(file_id.strip(), []).append(
            (f"schemas/{filename}", file_name.strip() if isinstance(file_name, str) else "")
        )

    # 同一 id 被 ≥2 个文件使用 → 冲突
    conflict_index = {sid: refs for sid, refs in id_to_refs.items() if len(refs) > 1}

    if conflict_index:
        _report_schema_id_duplicates(conflict_index, loading_errors)


def inspect_source_uniqueness(
    schema_files: dict[str, TableSchemaFile],
    loading_errors: list[LoadingError],
    schema_paths: dict[str, str] | None = None,
) -> None:
    """检测两个 schema 指向同一数据源（blocker）。

    schema_paths: schema id → 文件相对路径（来自 manifest 引用），
    用于把问题归属到具体配置文件；缺省时留空，由前端兜底展示。
    """
    from app.shared.core.project.schema.types_parts.schema_id import normalize_source_key

    resolved_schema_paths = schema_paths or {}
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
            # 结构化涉事实体清单：列出全部指向同一数据源的 schema（id 各不相同 → 可导航）
            involved = [
                _schema_involved_entity(
                    sid,
                    resolved_schema_paths.get(sid, ""),
                    getattr(schema_files[sid], "name", None),
                    True,
                )
                for sid in sids
            ]
            loading_errors.append(
                LoadingError(
                    id=ids.schema_source_duplicate(path_str, sheet_str),
                    severity="blocker",
                    title=f"有表指向了同一个数据文件：{source_display}",
                    description=(
                        f"数据源 '{source_display}' 被 {len(sids)} 个 schema 引用: {', '.join(sids)}。"
                        f"每个数据源只能被一个 schema 定义，否则读取会冲突。请删除重复的 schema 或修改其 source.path。"
                    ),
                    fix_hint=f"请保留其中一个 schema（如 {sids[0]}），删除或修改其他的。涉事实体见下方清单。",
                    error_type="SchemaSourceDuplicate",
                    # 归属到第一个引用该数据源的 schema 文件，前端"按文件"分组可见
                    file_path=resolved_schema_paths.get(primary_ref, ""),
                    ref_id=primary_ref,
                    message="",
                    suggestion=f"保留 schema '{sids[0]}'，删除或修改: {', '.join(sids[1:])}",
                    context={"involved": involved},
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
