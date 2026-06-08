"""
@fileoverview Schema 动作验证器

验证 AI 生成 Schema 相关动作（ADD_SCHEMA/UPDATE_SCHEMA/DELETE_SCHEMA）
的名称、列定义合法性。
"""

from __future__ import annotations

from typing import Any

from app.shared.services.llm.actions.validation_types import ValidationError

VALID_DATA_TYPES = {"string", "integer", "decimal", "boolean", "datetime", "date", "time", "float"}


def validate_schema_action(action: dict[str, Any], index: int) -> list[ValidationError]:
    """验证 Schema 操作

    检查 schemaSpec 中的名称、列定义合法性。
    """
    errors = []
    action_type = action.get("actionType", "")
    spec = action.get("schemaSpec", {})

    name = spec.get("name", "")
    schema_id = spec.get("schemaId") or spec.get("id")

    if action_type in ("ADD_SCHEMA", "UPDATE_SCHEMA") and not name and not schema_id:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_schema_name",
                message="Schema 名称不能为空",
                suggestion="请指定 name 字段",
            )
        )

    columns = spec.get("columns", [])
    if columns is not None:
        for col in columns:
            col_type = col.get("type", "string")
            if col_type not in VALID_DATA_TYPES:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="invalid_column_type",
                        message=f"不支持的数据类型: '{col_type}'",
                        suggestion=f"可用类型: {', '.join(sorted(VALID_DATA_TYPES))}",
                    )
                )

    if action_type in ("UPDATE_SCHEMA", "DELETE_SCHEMA") and not schema_id and not name:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_schema_id",
                message="更新/删除 Schema 需要指定 schemaId 或 name",
            )
        )

    return errors
