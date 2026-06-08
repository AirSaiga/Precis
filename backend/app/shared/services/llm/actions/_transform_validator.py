"""
@fileoverview Transform 动作验证器

验证 AI 生成 Transform 相关动作（ADD_TRANSFORM/UPDATE_TRANSFORM/DELETE_TRANSFORM）
的类型、参数合法性。
"""

from __future__ import annotations

from typing import Any

from app.shared.services.llm.actions.validation_types import ValidationError

VALID_TRANSFORM_TYPE_NAMES = {
    "StringSplit",
    "RegexExtract",
    "MathExpr",
    "DateFormat",
    "Lookup",
    "Strip",
    "UpperCase",
    "LowerCase",
    "Replace",
    "FilterRows",
    "FillNA",
    "DropDuplicates",
    "CastType",
    "Concat",
    "Substring",
    "Aggregate",
    "ConditionalAssign",
    "SortRows",
    "Digits",
    "WeightedSum",
    "Modulo",
    "MapValue",
}


def validate_transform_action(action: dict[str, Any], index: int) -> list[ValidationError]:
    """验证 Transform 操作

    检查 transformSpec 中的类型、参数合法性。
    """
    errors = []
    action_type = action.get("actionType", "")
    spec = action.get("transformSpec", {})

    if action_type == "ADD_TRANSFORM":
        transform_type = spec.get("type", "")
        if not transform_type:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_transform_type",
                    message="Transform 类型不能为空",
                    suggestion=f"可选: {', '.join(sorted(VALID_TRANSFORM_TYPE_NAMES))}",
                )
            )
        elif transform_type not in VALID_TRANSFORM_TYPE_NAMES:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="invalid_transform_type",
                    message=f"不支持的 Transform 类型: '{transform_type}'",
                    suggestion=f"可选: {', '.join(sorted(VALID_TRANSFORM_TYPE_NAMES))}",
                )
            )

    if action_type in ("UPDATE_TRANSFORM", "DELETE_TRANSFORM"):
        transform_id = spec.get("transformId") or spec.get("id")
        if not transform_id:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_transform_id",
                    message="更新/删除 Transform 需要指定 transformId",
                )
            )

    return errors
