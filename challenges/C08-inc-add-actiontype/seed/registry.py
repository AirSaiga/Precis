"""
AI 动作类型注册表（C08 精简版）。

这是动作类型的单一事实源。前端 frontend/src/types/generated/actions.ts
由 codegen 从本文件生成（npm run codegen），禁止手改。

修改本文件后必须跑 codegen 重新生成 actions.ts，否则 CI 失败。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ActionTypeDef:
    """动作类型定义。

    Attributes:
        type: 动作类型标识符（大写下划线）
        spec_field: 该动作的 spec 字段名（可为 None）
        category: 分类（constraint/schema/regex/transform/validate/canvas/settings）
        read_only: 是否只读（True → READ_ONLY_ACTION_TYPES，False → WRITE_ACTION_TYPES）
    """

    type: str
    spec_field: str | None
    category: str
    read_only: bool


# 动作类型注册表（单一事实源）
# 新增动作类型在此加一行，然后跑 codegen 更新 actions.ts
ACTIONS: dict[str, ActionTypeDef] = {
    "ADD_CONSTRAINT_NODE": ActionTypeDef(
        "ADD_CONSTRAINT_NODE", "constraintSpec", "constraint", False
    ),
    "ADD_SCHEMA": ActionTypeDef("ADD_SCHEMA", "schemaSpec", "schema", False),
    "VALIDATE_PROJECT": ActionTypeDef(
        "VALIDATE_PROJECT", "constraintSpec", "validate", True
    ),
    "ADD_TO_CANVAS": ActionTypeDef("ADD_TO_CANVAS", "canvasSpec", "canvas", True),
}
