# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 约束校验错误码 → 英文消息模板（开源国际发布用）

以 error_code（UPPER_SNAKE）为键维护英文消息模板，模板占位符（``{param}``）
与各校验器 emit 的 ``error_params`` 键严格一致——键名以
``backend/app/shared/domain/constraints/`` 下校验器源码为准（完整性由
``backend/tests/unit/test_messages_en.py`` 的源码扫描守卫保证）。

文案风格（与 README 术语一致）：
- 行级数据违规：``<Type> constraint violation: ...``（如 NotNull constraint violation）
- 配置类错误：``<Type> constraint failed: ...`` / ``... configuration error``
- 渲染失败（未知 code / 缺参数 / 异常）一律返回 None，调用方回退中文 error_message。
"""

from __future__ import annotations

import string
from typing import Any

# 英文消息模板注册表：键 = error_code，值 = 含 {param} 占位符的英文模板。
# 占位符名必须与校验器 emit 的 error_params 键一致；同一 code 在校验器内
# 存在多组参数分支时，模板只使用所有分支共有的键（保证任一分支都可渲染）。
ERROR_MESSAGES_EN: dict[str, str] = {
    # ---- NotNull ----
    "NOT_NULL_TABLE_NOT_FOUND": "NotNull constraint failed: table '{table}' is not in the dataset.",
    "NOT_NULL_COLUMN_NOT_FOUND": "NotNull constraint failed: column '{column}' does not exist in table '{table}'.",
    "NOT_NULL_VALUE_EMPTY": "NotNull constraint violation: column '{column}' must not be empty.",
    # ---- Unique ----
    "UNIQUE_TABLE_NOT_FOUND": "Unique constraint failed: table '{table}' is not in the dataset.",
    "UNIQUE_CONFIG_NO_COLUMNS": "Unique constraint configuration error: no columns specified.",
    "UNIQUE_COLUMN_NOT_FOUND": "Unique constraint failed: column '{column}' does not exist in table '{table}'.",
    "UNIQUE_VALUE_DUPLICATED": "Unique constraint violation: value '{value}' is not unique in column(s) '{columns}'.",
    # ---- AllowedValues ----
    "ALLOWED_VALUES_TABLE_NOT_FOUND": "AllowedValues constraint failed: table '{table}' is not in the dataset.",
    "ALLOWED_VALUES_COLUMN_NOT_FOUND": "AllowedValues constraint failed: column '{column}' does not exist in table '{table}'.",
    "ALLOWED_VALUES_NOT_PERMITTED": (
        "AllowedValues constraint violation: value '{value}' is not in the permitted set {allowed}."
    ),
    # ---- Range ----
    "RANGE_NO_BOUNDS": "Range constraint failed: no bounds configured (at least one of min_value / max_value is required).",
    "RANGE_TABLE_NOT_FOUND": "Range constraint failed: table '{table}' is not in the dataset.",
    "RANGE_COLUMN_NOT_FOUND": "Range constraint failed: column '{column}' does not exist in table '{table}'.",
    "RANGE_COLUMN_NOT_NUMERIC": (
        "Range constraint failed: invalid data format — column '{column}' is not numeric. "
        "Non-numeric fields cannot be checked with Range (no implicit string-to-number conversion)."
    ),
    # 注意：该 code 存在两种参数分支（含/不含 bounds），模板只用共有键 {value}
    "RANGE_VALUE_OUT_OF_RANGE": "Range constraint violation: value {value} is out of the allowed range.",
    "RANGE_VALUE_BELOW_MIN": "Range constraint violation: value {value} does not satisfy {op} {min}.",
    "RANGE_VALUE_ABOVE_MAX": "Range constraint violation: value {value} does not satisfy {op} {max}.",
    # ---- ForeignKey ----
    "FK_TABLE_NOT_FOUND": ("ForeignKey constraint failed: table '{from_table}' or '{to_table}' is not in the dataset."),
    "FK_COLUMN_NOT_FOUND": (
        "ForeignKey constraint failed: column '{from_column}' or '{to_column}' does not exist in its table."
    ),
    "FK_VIOLATION": (
        "ForeignKey constraint violation: value '{value}' does not exist in column '{to_column}' "
        "of target table '{to_table}'."
    ),
    # ---- Regex ----
    "REGEX_TABLE_NOT_FOUND": "Regex constraint failed: table '{table}' is not in the dataset.",
    "REGEX_COLUMN_NOT_FOUND": "Regex constraint failed: column '{column}' does not exist in table '{table}'.",
    "REGEX_PATTERN_EMPTY": "Regex constraint failed: pattern is empty; no regular expression provided.",
    "REGEX_INVALID_MATCH_MODE": (
        "Regex constraint configuration error: unknown match_mode '{match_mode}'; supported values are: {valid_modes}."
    ),
    "REGEX_VIOLATION": "Regex constraint violation: value '{value}' does not match the pattern '{pattern}'.",
    "REGEX_EXECUTION_ERROR": "Regex check error on value '{value}': {error_detail}.",
    "REGEX_PATTERN_SYNTAX_ERROR": "Regular expression syntax error in '{pattern}': {error_detail}.",
    # ---- Charset ----
    "CHARSET_TABLE_NOT_FOUND": "Charset constraint failed: table '{table}' is not in the dataset.",
    "CHARSET_COLUMN_NOT_FOUND": "Charset constraint failed: column '{column}' does not exist in table '{table}'.",
    "CHARSET_INVALID_MODE": (
        "Charset constraint configuration error: unknown charset mode '{charset_mode}'; "
        "supported modes are: {valid_modes}."
    ),
    "CHARSET_INVALID_CHARACTER": (
        "Charset constraint violation: value '{value}' contains characters outside the {charset_name} charset."
    ),
    # ---- Scripted ----
    "SCRIPTED_PERMISSION_DENIED": (
        "Scripted constraint '{name}' skipped: 'allow script eval' is not enabled in project settings."
    ),
    "SCRIPTED_TABLE_NOT_FOUND": "Scripted constraint failed: table '{table}' is not in the dataset.",
    "SCRIPTED_TIMEOUT": (
        "Scripted constraint '{name}' timed out: interrupted at row {processed}; {remaining} row(s) left unchecked."
    ),
    "SCRIPTED_NON_BOOL_RESULT": ("Rule '{name}' did not return a boolean (True/False); got {result_type} instead."),
    "SCRIPTED_VIOLATION": "Business logic check failed: '{name}'.",
    "SCRIPTED_EXECUTION_ERROR": (
        "Error while evaluating rule '{name}'; check the expression syntax or data types. ({detail})"
    ),
    # ---- Conditional ----
    "CONDITIONAL_TABLE_NOT_FOUND": "Conditional constraint failed: table '{table}' is not in the dataset.",
    "CONDITIONAL_COLUMN_NOT_FOUND": "Conditional constraint failed: column '{column}' does not exist in table '{table}'.",
    "CONDITIONAL_REF_COLUMN_NOT_FOUND": (
        "Conditional constraint failed: reference column '{column}' does not exist in table '{table}'."
    ),
    "CONDITIONAL_THEN_THRESHOLD_NOT_NUMERIC": (
        "Conditional constraint failed: the THEN threshold for '{operator}' must be numeric, "
        "got {threshold}; use a DateLogic constraint for date comparisons."
    ),
    "CONDITIONAL_UNKNOWN_IF_LOGIC": (
        "Conditional constraint failed: unknown if_logic '{if_logic}'; supported values are: and, or."
    ),
    "CONDITIONAL_IF_COLUMN_NOT_FOUND": (
        "Conditional constraint failed: column '{column}' does not exist in table '{table}'."
    ),
    "CONDITIONAL_INVALID_IF_CONDITION": "Conditional constraint failed: {detail}.",
    "CONDITIONAL_IF_VALUE_MISSING": (
        "Conditional constraint failed: if_value is not configured; the simple-condition mode requires "
        "a trigger value (if_value). Remove if_column to apply the THEN check to all rows."
    ),
    "CONDITIONAL_TIMEOUT": (
        "Conditional constraint timed out: interrupted at triggered row {processed} of {total}; "
        "remaining triggered rows were not checked."
    ),
    "CONDITIONAL_THEN_VIOLATION": (
        "Conditional constraint violation: when the condition holds, value '{value}' in column "
        "'{column}' does not satisfy the requirement ({condition})."
    ),
    # ---- Composite ----
    "COMPOSITE_ANY_ALL_FAILED": (
        "Composite constraint (logic=any) requires at least one sub-constraint to pass, "
        "but all {total} sub-constraints failed."
    ),
    "COMPOSITE_NONE_HAS_PASSED": (
        "Composite constraint (logic=none) requires all sub-constraints to fail, but {passed} sub-constraint(s) passed."
    ),
    # ---- DateLogic ----
    "DATE_LOGIC_TABLE_NOT_FOUND": "DateLogic constraint failed: table '{table}' is not in the dataset.",
    "DATE_LOGIC_COLUMN_NOT_FOUND": "DateLogic constraint failed: column '{column}' does not exist in table '{table}'.",
    # 该 code 存在两种参数分支（含/不含 boundary），模板只用共有键 {reference_date}
    "DATE_LOGIC_INVALID_REF_DATE": "DateLogic constraint failed: invalid reference date '{reference_date}'.",
    # 同上：含/不含 boundary 的两种分支，模板只用共有键 {column} / {table}
    "DATE_LOGIC_REF_COLUMN_NOT_FOUND": (
        "DateLogic constraint failed: reference column '{column}' does not exist in table '{table}'."
    ),
    "DATE_LOGIC_UNKNOWN_MODE": (
        "DateLogic constraint configuration error: unknown logic_mode '{logic_mode}'; "
        "supported modes are: compare, calculation."
    ),
    "DATE_LOGIC_INVALID_DATE_VALUE": "Invalid date: value '{value}' in column '{column}' cannot be parsed as a date.",
    "DATE_LOGIC_RANGE_BOUNDARY_MISMATCH": (
        "DateLogic constraint failed: range mode requires both a start and an end boundary of the same type "
        "(both fixed dates or both column references)."
    ),
    "DATE_LOGIC_RANGE_MISSING_END": (
        "DateLogic constraint failed: range mode requires an end boundary (reference_date_end or reference_column_end)."
    ),
    "DATE_LOGIC_RANGE_VIOLATION": ("Date range check failed: {value} is not within the range [{start}, {end}]."),
    "DATE_LOGIC_MISSING_REFERENCE": (
        "DateLogic constraint failed: compare mode requires a reference_column or reference_date."
    ),
    "DATE_LOGIC_UNSUPPORTED_OP": (
        "DateLogic constraint failed: unsupported comparison operator '{compare_op}'; "
        "supported operators are: {valid_ops}."
    ),
    "DATE_LOGIC_COMPARE_VIOLATION": "Date comparison failed: {value} should be {op} {reference}.",
    "DATE_LOGIC_AGE_VIOLATION": (
        "Age check failed: {value} (age {age}) does not satisfy the condition ({op} {target})."
    ),
    "DATE_LOGIC_TARGET_NOT_NUMERIC": (
        "DateLogic calculation target value '{target_value}' cannot be converted to a number ({detail}); "
        "check the constraint configuration."
    ),
    "DATE_LOGIC_MISSING_TARGET": (
        "DateLogic calculation configuration error: calculation_type={calculation_type} requires target_value."
    ),
    "DATE_LOGIC_MISSING_TARGET_COLUMN": (
        "DateLogic calculation configuration error: calculation_type={calculation_type} "
        "requires target_column (reference column)."
    ),
    "DATE_LOGIC_UNKNOWN_CALCULATION_TYPE": (
        "DateLogic calculation configuration error: unknown calculation_type '{calculation_type}'; "
        "supported types are: age, days_diff."
    ),
    "DATE_LOGIC_DAYS_DIFF_VIOLATION": (
        "Days-diff result does not match the target: {value} vs {reference}; "
        "required {op} {expected} day(s), got {actual}."
    ),
    # ---- 服务层同语义错误码（非 domain/constraints 校验器直发，但会流入同一错误通道）----
    "VALIDATION_EXECUTION_FAILED": "Constraint execution failed: {detail}.",
    "VALIDATION_UNSUPPORTED_TYPE": "Unsupported validation type '{validation_type}'.",
    "COLUMN_NOT_FOUND": "Column '{column}' does not exist in the table.",
    "COMPOSITE_SUB_CONSTRAINT_ERROR": "Composite sub-constraint ({sub_type}) raised an error: {detail}.",
    "COMPOSITE_UNKNOWN_SUB_TYPE": (
        "Composite constraint configuration error: unknown sub-constraint type(s): {unknown_types}."
    ),
    # ---- 流水线级错误码（executor.py / engine.py 顶层错误：超时/空数据/中断/分块失败）----
    # 注意：VALIDATION_INTERRUPTED 存在两种参数分支（仅 {remaining} / {table, remaining}），
    # 模板只用共有键 {remaining}，保证任一分支均可渲染
    "VALIDATION_TIMEOUT": "Validation timed out during the {phase} phase (limit: {seconds}s).",
    "VALIDATION_INTERRUPTED": (
        "Validation stopped on the first error per project settings: {remaining} remaining check(s) were not executed."
    ),
    "DATA_LOADING_EMPTY": "No data tables could be loaded from the data directory; validation aborted.",
    "CHUNKED_LOAD_FAILED": "Chunked data loading failed: {detail}.",
    # ---- 加载阶段错误码（data_loader.py 的 loading_errors，经 loading_warnings 通道透出）----
    "DATA_DIR_NOT_FOUND": "Data directory not found: {path}",
    "DATA_SOURCE_NOT_FOUND": "No data source found for table '{table}' (searched directory: {directory}).",
    # ---- 类型层/数据引擎错误码（data_types_parts + data_engine 的格式校验第一阶段错误）----
    # 注意：TYPE_NULL_NOT_ALLOWED 是 schema 层 nullable 语义（列定义不允许空），
    # 与约束层 NOT_NULL_VALUE_EMPTY（NotNull 约束）语义不同，码分开
    "TYPE_NULL_NOT_ALLOWED": "Column '{column}' does not allow empty values.",
    "TYPE_INT_FORMAT_INVALID": "Value '{value}' is not a strictly formatted integer (digits and an optional sign only).",
    "TYPE_INT_OVERFLOW": "Value '{value}' exceeds the safe integer range (±2^53) and may lose precision.",
    "TYPE_FLOAT_INVALID": "Value '{value}' is not a valid finite number.",
    "TYPE_DECIMAL_INVALID": "Value '{value}' is not a valid number.",
    "TYPE_DECIMAL_NOT_FINITE": "Value '{value}' is not a finite number (NaN and Infinity are not accepted).",
    "TYPE_DECIMAL_PRECISION": "Value '{value}' exceeds the precision limit ({precision} significant digits at most).",
    "TYPE_DECIMAL_SCALE": "Value '{value}' exceeds the decimal places limit ({scale} at most).",
    "TYPE_DATE_FORMAT_INVALID": "Value '{value}' is not a valid date (expected format YYYY-MM-DD).",
    "TYPE_BOOL_INVALID": "Value '{value}' is not a valid boolean (expected true/false, yes/no, 1/0, etc.).",
    "SCHEMA_COLUMN_MISSING": "Required column '{column}' is missing from the data table.",
}


def _template_placeholders(template: str) -> set[str]:
    """解析模板中的全部 ``{param}`` 占位符名（忽略 ``{{}}`` 转义与 format spec）。"""
    return {field_name for _, field_name, _, _ in string.Formatter().parse(template) if field_name}


def render_message_en(error_code: str | None, error_params: dict[str, Any] | None) -> str | None:
    """按错误码渲染英文错误消息。

    Args:
        error_code: 稳定错误码（UPPER_SNAKE），可为 None
        error_params: 插值参数字典，可为 None 或缺键

    Returns:
        渲染后的英文消息；未登记错误码 / 模板占位符缺参 / 渲染异常时返回 None
        （调用方应回退到中文 error_message）
    """
    if not error_code:
        return None
    template = ERROR_MESSAGES_EN.get(error_code)
    if template is None:
        return None
    # 安全兜底：渲染过程中的任何异常（参数类型不合法等）都回退 None，不向上抛
    try:
        placeholders = _template_placeholders(template)
        params = error_params or {}
        # 任一占位符缺参即回退——宁可回退中文原文也不输出残缺英文
        if any(name not in params for name in placeholders):
            return None
        return template.format(**{name: params[name] for name in placeholders})
    except Exception:
        return None
