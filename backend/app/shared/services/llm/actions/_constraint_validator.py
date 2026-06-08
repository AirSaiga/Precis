"""
@fileoverview 约束动作验证器

验证 AI 生成约束相关动作（ADD/UPDATE/DELETE_CONSTRAINT_NODE、VALIDATE_PROJECT）
的表/字段/约束类型/参数完整性。
"""

from __future__ import annotations

from typing import Any, Callable

from app.shared.services.llm.actions.validation_types import ValidationError
from app.shared.services.llm.suggestion_utils import (
    normalize_constraint_type,
    suggest_constraints_for_type,
    suggest_similar_column,
    suggest_similar_constraint_type,
    suggest_similar_table,
)


def validate_constraint_action(
    action: dict[str, Any],
    schema: dict[str, Any],
    index: int,
    required_params: dict[str, list[str]],
    type_compatibility_check: Callable[..., list[ValidationError]],
    foreign_key_check: Callable[..., list[ValidationError]],
) -> list[ValidationError]:
    """验证约束操作

    检查约束动作中的表、字段、约束类型和参数是否合法。
    """
    errors = []
    action_type = action.get("actionType", "")
    spec = action.get("constraintSpec", {})

    # 1. 验证表存在
    table_id = spec.get("targetNodeId")
    table_name = spec.get("tableName")

    if not table_id and not table_name:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_table",
                message="动作缺少表信息（targetNodeId 或 tableName）",
                suggestion="请指定要操作的表",
            )
        )
        return errors

    # 检查表是否存在
    table_info = None
    if table_id and table_id in schema["tables"]:
        table_info = schema["tables"][table_id]
    elif table_name:
        table_ids = schema["table_name_to_id"].get(table_name, [])
        if len(table_ids) == 1:
            table_info = schema["tables"].get(table_ids[0])
        elif len(table_ids) > 1:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="ambiguous_table_name",
                    message=f"表名 '{table_name}' 匹配到多个表",
                    suggestion=f"请使用表ID，可匹配的表: {', '.join(table_ids[:3])}...",
                )
            )
            return errors

    if not table_info:
        suggestion = suggest_similar_table(table_name or table_id, schema)
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="table_not_found",
                message=f"表 '{table_name or table_id}' 不存在",
                suggestion=suggestion,
                auto_fixable=False,
            )
        )
        return errors

    # 2. 验证字段存在
    column_name = spec.get("targetColumn")
    if not column_name:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="missing_column",
                message="动作缺少字段信息（targetColumn）",
                suggestion="请指定要操作的字段",
            )
        )
        return errors

    column_info = None
    for col_id, col_data in table_info["columns"].items():
        if col_id == column_name or col_data["name"] == column_name:
            column_info = col_data
            column_info["id"] = col_id
            break

    if not column_info:
        suggestion = suggest_similar_column(column_name, table_info)
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="column_not_found",
                message=f"字段 '{column_name}' 在表 '{table_info['name']}' 中不存在",
                suggestion=suggestion,
                auto_fixable=False,
            )
        )
        return errors

    # 3. 验证约束类型（ADD 和 UPDATE 需要）
    constraint_type = spec.get("type")
    if action_type in ["ADD_CONSTRAINT_NODE", "UPDATE_CONSTRAINT_NODE"]:
        if not constraint_type:
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="missing_constraint_type",
                    message="动作缺少约束类型（type）",
                    suggestion="请指定约束类型，如: NotNull, Unique, Range 等",
                )
            )
            return errors

        normalized_type = normalize_constraint_type(constraint_type)
        if normalized_type not in {
            "NotNull",
            "Unique",
            "Range",
            "AllowedValues",
            "ForeignKey",
            "Conditional",
            "Scripted",
            "DateLogic",
            "NOT_NULL",
            "UNIQUE",
            "RANGE",
            "ALLOWED_VALUES",
            "FOREIGN_KEY",
            "CONDITIONAL",
            "DATE_LOGIC",
            "REGEX",
        }:
            suggestion = suggest_similar_constraint_type(constraint_type)
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="invalid_constraint_type",
                    message=f"不支持的约束类型: '{constraint_type}'",
                    suggestion=suggestion,
                    auto_fixable=False,
                )
            )
            return errors

        # 4. 验证约束参数完整性
        param_errors = validate_constraint_params(
            normalized_type, spec, index, action_type, required_params, foreign_key_check
        )
        errors.extend(param_errors)

        # 5. 验证字段类型与约束类型兼容性
        if column_info and not param_errors:
            compat_errors = type_compatibility_check(column_info, normalized_type, index, action_type)
            errors.extend(compat_errors)

    return errors


def validate_validate_action(action: dict[str, Any], schema: dict[str, Any], index: int) -> list[ValidationError]:
    """验证 VALIDATE_PROJECT 动作

    检查动作中指定的表是否存在。
    """
    errors = []
    action_type = action.get("actionType", "")
    spec = action.get("constraintSpec", {})

    table_id = spec.get("targetNodeId")
    table_name = spec.get("tableName")
    tables = spec.get("tables") or spec.get("tableIds", [])

    if not table_id and not table_name and not tables:
        return errors

    tables_to_check = []
    if tables:
        tables_to_check = tables
    elif table_id:
        tables_to_check = [table_id]
    elif table_name:
        tables_to_check = [table_name]

    for table_ref in tables_to_check:
        table_exists = False
        if table_ref in schema["tables"]:
            table_exists = True
        elif table_ref in schema["table_name_to_id"]:
            table_exists = True

        if not table_exists:
            suggestion = suggest_similar_table(table_ref, schema)
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="table_not_found",
                    message=f"要校验的表 '{table_ref}' 不存在",
                    suggestion=suggestion,
                )
            )

    return errors


def validate_constraint_params(
    constraint_type: str,
    spec: dict[str, Any],
    index: int,
    action_type: str,
    required_params: dict[str, list[str]],
    foreign_key_check: callable,
) -> list[ValidationError]:
    """验证约束参数完整性

    检查约束动作中是否包含该约束类型所需的必填参数。
    """
    errors = []
    params = spec.get("params", {})

    required = required_params.get(constraint_type, [])
    if required:
        if constraint_type == "Range":
            has_min = "min" in params and params["min"] is not None
            has_max = "max" in params and params["max"] is not None
            if not has_min and not has_max:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_required_param",
                        message=f"{constraint_type} 约束需要至少一个 'min' 或 'max' 参数",
                        suggestion="请添加 params.min 或 params.max",
                    )
                )
        else:
            missing = [p for p in required if p not in params or params[p] is None]
            if missing:
                errors.append(
                    ValidationError(
                        action_index=index,
                        action_type=action_type,
                        error_type="missing_required_param",
                        message=f"{constraint_type} 约束缺少必需参数: {', '.join(missing)}",
                        suggestion=f"请在 params 中添加: {', '.join(missing)}",
                    )
                )

    if constraint_type == "ForeignKey":
        fk_errors = foreign_key_check(spec, index, action_type)
        errors.extend(fk_errors)

    return errors


def validate_foreign_key_reference(
    spec: dict[str, Any],
    index: int,
    action_type: str,
    schema: dict[str, Any],
) -> list[ValidationError]:
    """验证外键引用表和字段存在

    检查外键约束引用的目标表和目标字段是否存在于项目中。
    """
    errors = []
    params = spec.get("params", {})

    to_table_id = params.get("toTableId")
    to_column_id = params.get("toColumnId")

    if to_table_id:
        if to_table_id not in schema["tables"]:
            suggestion = suggest_similar_table(to_table_id, schema)
            errors.append(
                ValidationError(
                    action_index=index,
                    action_type=action_type,
                    error_type="foreign_key_table_not_found",
                    message=f"外键引用的表 '{to_table_id}' 不存在",
                    suggestion=suggestion,
                )
            )
        else:
            ref_table = schema["tables"][to_table_id]
            if to_column_id:
                column_exists = False
                for col_id, col_data in ref_table["columns"].items():
                    if col_id == to_column_id or col_data["name"] == to_column_id:
                        column_exists = True
                        break

                if not column_exists:
                    available_cols = list(ref_table["columns"].keys())[:5]
                    errors.append(
                        ValidationError(
                            action_index=index,
                            action_type=action_type,
                            error_type="foreign_key_column_not_found",
                            message=f"外键引用的字段 '{to_column_id}' 在表 '{ref_table['name']}' 中不存在",
                            suggestion=f"可用字段: {', '.join(available_cols)}...",
                        )
                    )

    return errors


def validate_type_compatibility(
    column_info: dict[str, Any],
    constraint_type: str,
    index: int,
    action_type: str,
) -> list[ValidationError]:
    """验证字段类型与约束类型兼容性

    检查约束类型是否适用于目标字段的数据类型。
    """
    errors = []
    col_type = column_info.get("type", "string").lower()

    numeric_constraints = {"Range", "DATE_LOGIC"}
    numeric_types = {"integer", "int", "decimal", "float", "number", "numeric"}

    if constraint_type in numeric_constraints and col_type not in numeric_types:
        errors.append(
            ValidationError(
                action_index=index,
                action_type=action_type,
                error_type="type_incompatibility",
                message=f"不能对 {col_type} 类型的字段使用 {constraint_type} 约束",
                suggestion=f"建议对 {col_type} 类型使用: " + suggest_constraints_for_type(col_type),
            )
        )

    return errors
