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
@fileoverview 前端指令生成模块（v2：变更集通知）

功能概述:
- 后端写盘后按 action 生成"变更集信封"：只声明哪个磁盘实体发生了什么变化，
  不再携带 columns/params/config 等实体数据
- 前端收到信封后从磁盘重读（importV2ResourceToCanvas）重建画布，文件是唯一事实源（D1）
- 信封字段：instructionId / actionType / op / kind / entityId / filePath
- 契约文档：docs/contracts/frontend-instructions-v2.md

关键恒等约束:
- entityId 必须解析为磁盘真实 id（YAML 内容的 id 字段），与画布节点 id 相等；
  ADD/UPDATE 通过重读磁盘拿到真实 id，DELETE 由 handler 在删文件前回传 resolved_id
- filePath 为项目相对路径（POSIX 分隔符）
- 独立约束文件的 id 是确定性派生（类型+表+列），生成器镜像写盘路径的同一套派生
- 内联约束没有独立磁盘实体：变更落在宿主 schema 文件，统一降级为 kind=schema 的
  update 条目（前端重读 schema 即可重建内嵌约束）
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP
from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id

logger = logging.getLogger(__name__)


# 动作分类集合从注册表派生（单一事实源），避免本地硬编码与注册表不同步
from app.shared.services.llm.actions.registry import (
    CONSTRAINT_ACTION_TYPES,
    REGEX_ACTION_TYPES,
    SCHEMA_ACTION_TYPES,
    TRANSFORM_ACTION_TYPES,
)

# kind → (目录, 文件后缀)：兜底推导 filePath 用（与 V2 目录约定一致）
_KIND_DIR_SUFFIX = {
    "schema": ("schemas", ".schema.yaml"),
    "constraint": ("constraints", ".constraint.yaml"),
    "regex": ("regex", ".regex.yaml"),
    "transform": ("transforms", ".transform.yaml"),
}

# ADD_TO_CANVAS 的资源定位口径（与 _canvas_validator._list_existing_resource_ids 一致）
_CANVAS_DIR_PATTERN = {
    "schema": ("schemas", "*.schema.yaml"),
    "regex": ("regex", "*.regex.yaml"),
    "constraint": ("constraints", "*.constraint.yaml"),
    "transform": ("transforms", "*.transform.yaml"),
}

# 已知资源文件后缀（长后缀在前，避免 "x.schema.yaml" 只剥掉 ".yaml"）
_RESOURCE_SUFFIXES = (
    ".constraint.yaml",
    ".schema.yaml",
    ".regex.yaml",
    ".transform.yaml",
    ".yaml",
    ".yml",
)


def _read_yaml_file(path: Path) -> dict[str, Any] | None:
    """安全读取 YAML 文件，失败返回 None（仅用于指令生成时重读磁盘真实结果）。"""
    try:
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        logger.warning(f"[frontend_instructions] 重读文件失败 {path}: {e}")
        return None


def _stem_id(path: Path) -> str:
    """从文件名推导实体 id（剥掉已知的资源后缀，长后缀优先）。"""
    name = path.name
    for suffix in _RESOURCE_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return path.stem


def _op_from_action_type(action_type: str) -> str:
    """从 actionType 推导文件级操作：DELETE→remove，UPDATE→update，ADD→add。"""
    if action_type.startswith("DELETE"):
        return "remove"
    if action_type.startswith("UPDATE"):
        return "update"
    return "add"


def _envelope(action_type: str, op: str, kind: str, entity_id: str, file_path: str) -> dict[str, Any] | None:
    """构建变更集信封条目。entityId 为空时返回 None（无法定位实体则不发指令）。"""
    if not entity_id:
        logger.warning(f"[frontend_instructions] 无法解析实体 id，跳过指令生成: {action_type} kind={kind}")
        return None
    return {
        "instructionId": f"{op}:{kind}:{entity_id}",
        "actionType": action_type,
        "op": op,
        "kind": kind,
        "entityId": entity_id,
        "filePath": file_path,
    }


def _fallback_path(kind: str, entity_id: str) -> str:
    """磁盘定位失败时的兜底路径推导（按 V2 目录约定拼相对路径）。"""
    subdir, suffix = _KIND_DIR_SUFFIX.get(kind, (kind, ".yaml"))
    return f"{subdir}/{entity_id}{suffix}"


def _locate_entity(
    workspace_path: str,
    dir_patterns: list[tuple[str, str]],
    keys: list[str],
    match_name: bool = True,
) -> tuple[str, str] | None:
    """在磁盘定位资源实体，返回 (真实 id, 项目相对路径)，找不到返回 None。

    匹配口径与各写盘 handler 的 _find_xxx_file 对齐：YAML 内容的 id（match_name
    时含 name）等于任一非空 key 即命中。真实 id 优先取内容 id 字段，缺失时回退
    文件名推导。
    """
    if not workspace_path:
        return None
    nonempty = [str(k) for k in keys if k]
    if not nonempty:
        return None
    workspace = Path(workspace_path)
    for subdir, pattern in dir_patterns:
        target_dir = workspace / subdir
        if not target_dir.exists():
            continue
        for f in sorted(target_dir.glob(pattern)):
            data = _read_yaml_file(f)
            if data is None:
                continue
            fid = data.get("id")
            candidates = [str(fid)] if fid not in (None, "") else []
            if match_name:
                fname = data.get("name")
                if fname not in (None, ""):
                    candidates.append(str(fname))
            if not any(c == k for c in candidates for k in nonempty):
                continue
            real_id = str(fid) if fid not in (None, "") else _stem_id(f)
            return real_id, f.relative_to(workspace).as_posix()
    return None


def generate_frontend_instructions(
    action: dict[str, Any], workspace_path: str = "", resolved_id: str = ""
) -> dict[str, Any] | None:
    """
    @methoddesc 生成前端变更集指令（通用入口）

    根据 actionType 分发到对应的信封生成器。指令只描述"哪个磁盘实体变了"，
    实体数据由前端经 importV2ResourceToCanvas 从磁盘重读。

    参数:
        action: 动作字典，包含 actionType 和对应的 spec
        workspace_path: 项目工作区路径，用于重读磁盘解析真实实体 id 与路径
        resolved_id: DELETE 类动作由 handler 在删文件前回传的真实 id（文件已删，
            生成器无法自行重读；空串表示未提供，退回 spec key 兜底）

    返回:
        变更集信封字典；无法映射到磁盘实体（UPDATE_SETTINGS / 未知动作 /
        实体 id 缺失）时返回 None
    """
    action_type = str(action.get("actionType", ""))

    if action_type in CONSTRAINT_ACTION_TYPES:
        return _generate_constraint_instruction(action, workspace_path)
    elif action_type in SCHEMA_ACTION_TYPES:
        return _generate_schema_instruction(action, workspace_path, resolved_id)
    elif action_type in REGEX_ACTION_TYPES:
        return _generate_regex_instruction(action, workspace_path, resolved_id)
    elif action_type in TRANSFORM_ACTION_TYPES:
        return _generate_transform_instruction(action, workspace_path, resolved_id)
    elif action_type == "ADD_TO_CANVAS":
        return _generate_canvas_instruction(action, workspace_path)
    else:
        # UPDATE_SETTINGS 写 project.precis.yaml 无独立实体文件、VALIDATE_PROJECT
        # 纯读：均不产生画布变更集条目（旧版返回 {"actionType": ...} 空壳已废弃）
        logger.info(f"[frontend_instructions] 动作 {action_type} 无磁盘实体变更，不生成指令")
        return None


def _generate_constraint_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any] | None:
    """
    生成约束类变更集条目

    - 独立约束（constraints/*.constraint.yaml）：kind=constraint，entityId 用与
      写盘路径（update_yaml_config / delete_constraint_file）完全相同的确定性
      派生——同一动作下"写出的文件名"与"指令里的 entityId"恒等
    - 内联约束：无独立磁盘文件，变更落在宿主 schema 文件 → 统一降级为
      kind=schema、op=update 的条目（同一 schema 的多条内联操作天然按
      instructionId 去重为一次重读）
    """
    action_type = str(action.get("actionType", ""))
    spec = action.get("constraintSpec", {}) or {}

    # 与写盘路径同一映射（CONSTRAINT_TYPE_MAP，非 normalize_constraint_type）：
    # entityId 派生必须与文件名派生逐字节一致，换更强的归一化反而制造漂移
    raw_type = spec.get("type", "")
    std_type = CONSTRAINT_TYPE_MAP.get(raw_type, raw_type)

    table_name = spec.get("tableName", "")
    target_node_id = spec.get("targetNodeId", "")
    target_column = spec.get("targetColumn", "")
    target_column_id = spec.get("targetColumnId", "")
    target_columns = spec.get("targetColumnIds") or spec.get("targetColumns") or []
    is_inline = bool(spec.get("isInline", False))
    op = _op_from_action_type(action_type)

    if is_inline:
        # 宿主 schema 文件在增/改/删后仍然存在，重读拿真实 id 与路径
        # （定位口径与 _delete_inline_constraint / update_yaml_config 内联分支一致）
        host_keys = [target_node_id or table_name, table_name]
        located = _locate_entity(workspace_path, [("schemas", "*.yaml")], host_keys, match_name=True)
        if located:
            entity_id, rel_path = located
        else:
            entity_id = str(target_node_id or table_name)
            rel_path = _fallback_path("schema", entity_id)
        # 文件级语义：schema 文件被修改（而非被删除），一律 update
        return _envelope(action_type, "update", "schema", entity_id, rel_path)

    # 独立约束：镜像 update_yaml_config 的 filename_table/filename_column 派生
    filename_table = table_name or target_node_id or "unknown"
    filename_column = (
        target_column or target_column_id or ("_".join(str(c) for c in target_columns) if target_columns else "unknown")
    )
    constraint_id = _generate_constraint_id(std_type, filename_table, filename_column)
    return _envelope(action_type, op, "constraint", constraint_id, f"constraints/{constraint_id}.constraint.yaml")


def _generate_schema_instruction(
    action: dict[str, Any], workspace_path: str = "", resolved_id: str = ""
) -> dict[str, Any] | None:
    """生成 Schema 类变更集条目。

    ADD/UPDATE：重读磁盘拿真实 id 与路径（LLM 可能只给 name，画布节点 id 是文件 id）。
    DELETE：文件已删无法重读，用 handler 回传的 resolved_id，缺省退回 spec key。
    """
    action_type = str(action.get("actionType", ""))
    spec = action.get("schemaSpec", {}) or {}
    # 与 _update_schema/_delete_schema 相同的 key 优先级
    key = spec.get("schemaId") or spec.get("id") or spec.get("name") or ""

    located = _locate_entity(workspace_path, [("schemas", "*.yaml")], [key], match_name=True)
    if located:
        entity_id, rel_path = located
    else:
        entity_id = str(resolved_id or key)
        rel_path = _fallback_path("schema", entity_id)
    return _envelope(action_type, _op_from_action_type(action_type), "schema", entity_id, rel_path)


def _generate_regex_instruction(
    action: dict[str, Any], workspace_path: str = "", resolved_id: str = ""
) -> dict[str, Any] | None:
    """生成 Regex 类变更集条目。

    目录搜索顺序镜像 _find_regex_file：先历史 regex_nodes/ 再标准 regex/。
    DELETE 用 handler 回传的 resolved_id 兜底。
    """
    action_type = str(action.get("actionType", ""))
    spec = action.get("regexSpec", {}) or {}
    key = spec.get("regexId") or spec.get("id") or spec.get("name") or ""

    located = _locate_entity(workspace_path, [("regex_nodes", "*.yaml"), ("regex", "*.yaml")], [key], match_name=True)
    if located:
        entity_id, rel_path = located
    else:
        entity_id = str(resolved_id or key)
        rel_path = _fallback_path("regex", entity_id)
    return _envelope(action_type, _op_from_action_type(action_type), "regex", entity_id, rel_path)


def _generate_transform_instruction(
    action: dict[str, Any], workspace_path: str = "", resolved_id: str = ""
) -> dict[str, Any] | None:
    """生成 Transform 类变更集条目。

    ADD 未显式给 id 时写盘侧会自动生成（含随机短哈希），必须重读磁盘拿真实 id。
    匹配口径镜像 _find_transform_file：仅按内容 id 匹配。
    """
    action_type = str(action.get("actionType", ""))
    spec = action.get("transformSpec", {}) or {}
    key = spec.get("transformId") or spec.get("id") or ""

    located = _locate_entity(workspace_path, [("transforms", "*.yaml")], [key], match_name=False)
    if located:
        entity_id, rel_path = located
    else:
        entity_id = str(resolved_id or key)
        rel_path = _fallback_path("transform", entity_id)
    return _envelope(action_type, _op_from_action_type(action_type), "transform", entity_id, rel_path)


def _generate_canvas_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any] | None:
    """生成 ADD_TO_CANVAS 变更集条目（统一到同一信封，op=add）。

    语义：把已存在的磁盘资源配置显示到画布（不写盘）。重读磁盘解析真实
    resourceId（LLM 可能只给 name）与文件路径；找不到时退回 spec 标识兜底。
    """
    action_type = str(action.get("actionType", "ADD_TO_CANVAS"))
    spec = action.get("canvasSpec", {}) or {}
    kind = spec.get("resourceKind", "")
    resource_id = spec.get("resourceId") or ""
    resource_name = spec.get("resourceName") or spec.get("name") or ""

    if kind not in _CANVAS_DIR_PATTERN:
        logger.warning(f"[frontend_instructions] ADD_TO_CANVAS 不支持的资源类型: {kind}")
        return None

    subdir, pattern = _CANVAS_DIR_PATTERN[kind]
    located = _locate_entity(workspace_path, [(subdir, pattern)], [resource_id, resource_name], match_name=True)
    if located:
        entity_id, rel_path = located
    else:
        entity_id = str(resource_id or resource_name)
        rel_path = _fallback_path(kind, entity_id)
    return _envelope(action_type, "add", kind, entity_id, rel_path)
