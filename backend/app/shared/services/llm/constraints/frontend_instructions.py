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

from typing import Any

from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id
from app.shared.services.llm.schema_resolver import _resolve_id_from_name

CONSTRAINT_ACTION_TYPES = {"ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE", "DELETE_CONSTRAINT_NODE"}
SCHEMA_ACTION_TYPES = {"ADD_SCHEMA", "UPDATE_SCHEMA", "DELETE_SCHEMA"}
REGEX_ACTION_TYPES = {"ADD_REGEX", "UPDATE_REGEX", "DELETE_REGEX"}
TRANSFORM_ACTION_TYPES = {"ADD_TRANSFORM", "UPDATE_TRANSFORM", "DELETE_TRANSFORM"}


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
        return _generate_schema_instruction(action)
    elif action_type in REGEX_ACTION_TYPES:
        return _generate_regex_instruction(action)
    elif action_type in TRANSFORM_ACTION_TYPES:
        return _generate_transform_instruction(action)
    elif action_type == "UPDATE_SETTINGS":
        return _generate_settings_instruction(action)
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


def _generate_schema_instruction(action: dict[str, Any]) -> dict[str, Any]:
    """生成 Schema 类前端指令"""
    action_type = action.get("actionType")
    spec = action.get("schemaSpec", {})
    return {
        "actionType": action_type,
        "schemaSpec": {
            "name": spec.get("name", ""),
            "schemaId": spec.get("schemaId") or spec.get("id", ""),
            "columns": spec.get("columns", []),
            "source": spec.get("source"),
        },
    }


def _generate_regex_instruction(action: dict[str, Any]) -> dict[str, Any]:
    """生成 Regex 类前端指令"""
    action_type = action.get("actionType")
    spec = action.get("regexSpec", {})
    return {
        "actionType": action_type,
        "regexSpec": {
            "name": spec.get("name", ""),
            "regexId": spec.get("regexId") or spec.get("id", ""),
            "pattern": spec.get("pattern", ""),
            "matchMode": spec.get("matchMode", "full"),
            "caseSensitive": spec.get("caseSensitive", False),
            "targetNodeId": spec.get("targetNodeId"),
            "targetColumn": spec.get("targetColumn"),
            "description": spec.get("description"),
        },
    }


def _generate_transform_instruction(action: dict[str, Any]) -> dict[str, Any]:
    """生成 Transform 类前端指令"""
    action_type = action.get("actionType")
    spec = action.get("transformSpec", {})
    return {
        "actionType": action_type,
        "transformSpec": {
            "transformId": spec.get("transformId") or spec.get("id", ""),
            "type": spec.get("type", ""),
            "description": spec.get("description"),
            "inputFromNode": spec.get("inputFromNode"),
            "inputColumn": spec.get("inputColumn"),
            "params": spec.get("params", {}),
            "outputColumns": spec.get("outputColumns", []),
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
