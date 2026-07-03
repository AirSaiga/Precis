"""
@fileoverview 前端渲染指令生成模块

功能概述:
- 根据动作类型生成前端渲染指令
- 支持约束、Schema、Regex、Transform、Settings 全部操作
- 统一指令格式，便于前端 dispatcher 分发处理
- 约束指令的 targetNodeId 走与写 YAML 相同的名称→ID fallback 解析，
  保证"写文件"和"生成前端指令"两条出口的 ID 解析能力对等
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id
from app.shared.services.llm.schema_resolver import _resolve_id_from_name

logger = logging.getLogger(__name__)


def _read_yaml_file(path: Path) -> dict[str, Any] | None:
    """安全读取 YAML 文件，失败返回 None（仅用于 UPDATE 指令重读磁盘真实结果）。"""
    try:
        if not path.exists():
            return None
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        logger.warning(f"[frontend_instructions] 重读文件失败 {path}: {e}")
        return None


# 动作分类集合从注册表派生（单一事实源），避免本地硬编码与注册表不同步
from app.shared.services.llm.actions.registry import (
    CONSTRAINT_ACTION_TYPES,
    REGEX_ACTION_TYPES,
    SCHEMA_ACTION_TYPES,
    TRANSFORM_ACTION_TYPES,
)


def generate_frontend_instructions(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any]:
    """
    @methoddesc 生成前端渲染指令（通用入口）

    根据 actionType 分发到对应的指令生成器。
    workspace_path 用于约束指令的名称→ID fallback 解析，
    保证 targetNodeId 与写 YAML 路径使用同一套解析逻辑。

    参数:
        action: 动作字典，包含 actionType 和对应的 spec
        workspace_path: 项目工作区路径，启用约束指令的 ID 解析（默认空=原样透传）

    返回:
        前端渲染指令字典
    """
    action_type = action.get("actionType", "")

    if action_type in CONSTRAINT_ACTION_TYPES:
        return _generate_constraint_instruction(action, workspace_path)
    elif action_type in SCHEMA_ACTION_TYPES:
        return _generate_schema_instruction(action, workspace_path)
    elif action_type in REGEX_ACTION_TYPES:
        return _generate_regex_instruction(action, workspace_path)
    elif action_type in TRANSFORM_ACTION_TYPES:
        return _generate_transform_instruction(action, workspace_path)
    elif action_type == "UPDATE_SETTINGS":
        return _generate_settings_instruction(action)
    elif action_type == "ADD_TO_CANVAS":
        return _generate_canvas_instruction(action, workspace_path)
    else:
        return {"actionType": action_type}


def _generate_constraint_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any]:
    """
    生成约束类前端指令

    与 _build_constraint_refs 保持对等的 ID 解析能力：
    当 targetNodeId 为空或可疑时，用 _resolve_id_from_name 从 schema 文件
    解析出确定性的 table_id / column_id，避免前端拿到 AI 原话找不到节点。
    """
    action_type = action.get("actionType")
    constraint_spec = action.get("constraintSpec", {})

    constraint_type = constraint_spec.get("type", "")
    target_node_id = constraint_spec.get("targetNodeId", "")
    target_column_id = constraint_spec.get("targetColumnId", "")
    table_name = constraint_spec.get("tableName", "")
    target_column = constraint_spec.get("targetColumn", "")
    is_inline = constraint_spec.get("isInline", False)

    # 关键：与写 YAML 路径（_build_constraint_refs）相同的 fallback 解析
    # 当 workspace_path 可用时，把 tableName/targetColumn 解析为确定性的 schema/column ID
    if workspace_path and table_name:
        fallback_table_id, fallback_column_id = _resolve_id_from_name(
            workspace_path, table_name, target_column or target_column_id
        )
        # 仅在 AI 未给出明确 ID、或给出空值时，用 fallback 覆盖
        # （AI 明确给出的非空 ID 优先，尊重其意图）
        if fallback_table_id and not target_node_id:
            target_node_id = fallback_table_id
        if fallback_column_id and not target_column_id:
            target_column_id = fallback_column_id

    filename_table = table_name or target_node_id or "unknown"
    filename_column = target_column or target_column_id or "unknown"

    constraint_id = _generate_constraint_id(constraint_type, filename_table or "inline", filename_column)

    return {
        "actionType": action_type,
        "constraintSpec": {
            "type": constraint_type,
            "targetNodeId": target_node_id,
            "targetColumnId": target_column_id,
            "tableName": table_name,
            "targetColumn": target_column,
            "constraintId": constraint_id,
            "isInline": is_inline,
        },
    }


def _generate_schema_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any]:
    """生成 Schema 类前端指令。

    ADD：回声输入（输入即落盘结果）。
    UPDATE：重读磁盘，返回合并后的真实完整列/源（避免回声仅含 LLM 增量导致画布丢列）。
    DELETE：只需 id/name 用于前端定位，不重读（文件已删）。
    """
    action_type = action.get("actionType")
    spec = action.get("schemaSpec", {})
    schema_id = spec.get("schemaId") or spec.get("id", "")
    name = spec.get("name", "")

    columns = spec.get("columns", [])
    source = spec.get("source")

    # UPDATE 时重读磁盘真实结果（_update_schema 会保留未列出的列，回声会丢列）
    if action_type == "UPDATE_SCHEMA" and workspace_path:
        schemas_dir = Path(workspace_path) / "schemas"
        # 按与 handler 一致的方式定位文件：先按 id，再按 name
        candidates = list(schemas_dir.glob("*.yaml")) if schemas_dir.exists() else []
        for sf in candidates:
            data = _read_yaml_file(sf)
            if data and (data.get("id") == schema_id or (name and data.get("name") == name)):
                columns = data.get("columns", columns)
                source = data.get("source", source)
                break

    return {
        "actionType": action_type,
        "schemaSpec": {
            "name": name,
            "schemaId": schema_id,
            "columns": columns,
            "source": source,
        },
    }


def _generate_regex_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any]:
    """生成 Regex 类前端指令。

    ADD：回声输入。UPDATE：重读磁盘真实 pattern/matchMode 等（整段替换，回声≈结果，重读为一致性）。
    DELETE：只需 id/name 定位，不重读。
    """
    action_type = action.get("actionType")
    spec = action.get("regexSpec", {})
    regex_id = spec.get("regexId") or spec.get("id", "")
    name = spec.get("name", "")

    pattern = spec.get("pattern", "")
    match_mode = spec.get("matchMode", "full")
    case_sensitive = spec.get("caseSensitive", False)
    description = spec.get("description")

    if action_type == "UPDATE_REGEX" and workspace_path and regex_id:
        data = _read_yaml_file(Path(workspace_path) / "regex" / f"{regex_id}.regex.yaml")
        if data:
            pattern = data.get("pattern", pattern)
            match_mode = data.get("matchMode", match_mode)
            case_sensitive = data.get("caseSensitive", case_sensitive)
            description = data.get("description", description)

    return {
        "actionType": action_type,
        "regexSpec": {
            "name": name,
            "regexId": regex_id,
            "pattern": pattern,
            "matchMode": match_mode,
            "caseSensitive": case_sensitive,
            "targetNodeId": spec.get("targetNodeId"),
            "targetColumn": spec.get("targetColumn"),
            "description": description,
        },
    }


def _generate_transform_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any]:
    """生成 Transform 类前端指令。

    ADD：回声输入。UPDATE：重读磁盘真实 params 等（整段替换，回声≈结果，重读为一致性）。
    DELETE：只需 id 定位，不重读。
    """
    action_type = action.get("actionType")
    spec = action.get("transformSpec", {})
    transform_id = spec.get("transformId") or spec.get("id", "")

    params = spec.get("params", {})
    output_columns = spec.get("outputColumns", [])
    description = spec.get("description")

    if action_type == "UPDATE_TRANSFORM" and workspace_path and transform_id:
        data = _read_yaml_file(Path(workspace_path) / "transforms" / f"{transform_id}.transform.yaml")
        if data:
            params = data.get("params", params)
            output_columns = data.get("outputColumns", output_columns)
            description = data.get("description", description)

    return {
        "actionType": action_type,
        "transformSpec": {
            "transformId": transform_id,
            "type": spec.get("type", ""),
            "description": description,
            "inputFromNode": spec.get("inputFromNode"),
            "inputColumn": spec.get("inputColumn"),
            "params": params,
            "outputColumns": output_columns,
        },
    }


def _generate_settings_instruction(action: dict[str, Any]) -> dict[str, Any]:
    """生成 Settings 类前端指令"""
    action_type = action.get("actionType")
    spec = action.get("settingsSpec", {})
    return {
        "actionType": action_type,
        "settingsSpec": {
            "category": spec.get("category", ""),
            "settings": spec.get("settings", {}),
        },
    }


def _generate_canvas_instruction(action: dict[str, Any], workspace_path: str = "") -> dict[str, Any]:
    """生成 ADD_TO_CANVAS 前端指令（重读磁盘真实配置）

    与 ADD_*（回声输入）不同：ADD_TO_CANVAS 的语义是"显示已存在的配置到画布"，
    故重读磁盘拿到真实数据（columns/source/pattern 等），保证画布显示与配置一致，
    而非依赖 LLM 输入（可能不完整或与磁盘不同步）。

    前端收到后委托 graphStore.importV2ResourceToCanvas 创建节点（幂等）。
    """
    spec = action.get("canvasSpec", {})
    resource_kind = spec.get("resourceKind", "")
    resource_id = spec.get("resourceId", "")
    resource_name = spec.get("resourceName") or spec.get("name", "")

    # 定位磁盘配置文件并重读真实数据
    # dir_map 与 _canvas_validator._list_existing_resource_ids 保持一致
    dir_map = {
        "schema": ("schemas", "*.schema.yaml"),
        "regex": ("regex", "*.regex.yaml"),
        "constraint": ("constraints", "*.constraint.yaml"),
        "transform": ("transforms", "*.transform.yaml"),
    }
    real_config: dict[str, Any] = {}
    if workspace_path and resource_kind in dir_map:
        subdir, pattern = dir_map[resource_kind]
        target_dir = Path(workspace_path) / subdir
        if target_dir.exists():
            for f in target_dir.glob(pattern):
                data = _read_yaml_file(f)
                if not data:
                    continue
                # 按 id 或 name 匹配目标资源
                fid = data.get("id", "")
                fname = data.get("name", "")
                if (resource_id and str(fid) == str(resource_id)) or (
                    resource_name and str(fname) == str(resource_name)
                ):
                    real_config = data
                    # 同步补全 resourceId（若 LLM 只给了 name）
                    if not resource_id and fid:
                        resource_id = str(fid)
                    break

    return {
        "actionType": "ADD_TO_CANVAS",
        "canvasSpec": {
            "resourceKind": resource_kind,
            "resourceId": resource_id,
            "name": resource_name,
            # 透传重读的真实配置，前端可据此直接构建节点（importV2ResourceToCanvas 也会独立重读，
            # 但携带 config 可让前端在不依赖 API 往返时也能渲染）
            "config": real_config,
        },
    }
