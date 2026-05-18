"""
@fileoverview 前端渲染指令生成模块

功能概述:
- 根据约束动作生成前端渲染指令
- 统一约束 ID 生成和命名规范

输入示例:
    instructions = generate_frontend_instructions(action)

输出示例:
    {
        "actionType": "AddConstraint",
        "constraintSpec": {
            "type": "NotNull",
            "targetNodeId": "users",
            "targetColumnId": "email",
            "constraintId": "notnull_users_email",
            ...
        }
    }
"""

from __future__ import annotations

from typing import Any

from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id


def generate_frontend_instructions(action: dict[str, Any]) -> dict[str, Any]:
    """
    @methoddesc 生成前端渲染指令

    根据约束动作生成前端需要的渲染指令，包括约束 ID、类型、目标节点等信息。

    参数:
        action: 动作字典，包含 actionType 和 constraintSpec

    返回:
        前端渲染指令字典

    示例:
        >>> generate_frontend_instructions({
        ...     "actionType": "ADD_CONSTRAINT_NODE",
        ...     "constraintSpec": {"type": "NotNull", "targetNodeId": "users", "targetColumnId": "email"}
        ... })
        {"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"constraintId": "notnull_users_email", ...}}
    """
    action_type = action.get("actionType")
    constraint_spec = action.get("constraintSpec", {})

    constraint_type = constraint_spec.get("type", "")
    target_node_id = constraint_spec.get("targetNodeId", "")
    target_column_id = constraint_spec.get("targetColumnId", "")
    table_name = constraint_spec.get("tableName", "")
    target_column = constraint_spec.get("targetColumn", "")
    is_inline = constraint_spec.get("isInline", False)

    # 优先使用可读名称生成 ID 供前端显示，保持一致性
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
