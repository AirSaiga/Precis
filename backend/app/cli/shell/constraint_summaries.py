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
"""@fileoverview 校验摘要约束标签的英文渲染（describe_data 结构化描述 → 可读标签）

约束 domain 层的 ``describe_data()`` 返回结构化配置（kind + 表/列/原始参数），
本模块在 CLI 英文界面把它渲染为可读标签（"NotNull: orders.order_id" 一类）。
中文界面不经过本模块——直接沿用 ``description`` 原文（与历史输出零差异）。

渲染失败安全网：未知 kind / 关键字段缺失时返回 None，调用方回退 description。
"""

from __future__ import annotations

from typing import Any

# 字符集模式 → 英文名（与 zh 的 charset_name_map 对位）
_CHARSET_NAMES_EN = {
    "ascii": "ASCII",
    "chinese": "Chinese",
    "chinese_mixed": "Chinese (mixed)",
}

# 允许值清单的展示截断（与 zh description 的"前 5 个"口径一致）
_ALLOWED_PREVIEW_LIMIT = 5


def _allowed_values_preview(values: list) -> str:
    """允许值清单的英文展示：≤5 个完整列出，超出截断前 5 个加省略号。"""
    if len(values) <= _ALLOWED_PREVIEW_LIMIT:
        return str(values)
    return f"{values[:_ALLOWED_PREVIEW_LIMIT]}..."


def _range_suffix(d: dict[str, Any]) -> str | None:
    """Range 的边界后缀：双边界 [a, b]/(a, b)、单边界 >= a / < b，无边界 None。"""
    lo, hi, mode = d.get("min"), d.get("max"), d.get("boundary_mode")
    inclusive = mode != "exclusive"
    if lo is not None and hi is not None:
        return f"range [{lo}, {hi}]" if inclusive else f"range ({lo}, {hi})"
    if lo is not None:
        return f">= {lo}" if inclusive else f"> {lo}"
    if hi is not None:
        return f"<= {hi}" if inclusive else f"< {hi}"
    return None


def _conditional_then_clause(then: Any) -> str:
    """Conditional 的 THEN 子句可读化（DSL dict / 注册规则名 / 未知）。"""
    if isinstance(then, dict):
        return f"satisfy DSL {then}"
    if isinstance(then, str):
        return f"satisfy registered rule '{then}'"
    return "satisfy an unknown rule"


def _date_logic_suffix(d: dict[str, Any]) -> str:
    """DateLogic 的模式后缀：compare（含 range）/ calculation，镜像 zh 描述逻辑。"""
    if d.get("logic_mode") == "compare":
        op = d.get("compare_op") or "gt"
        if op == "range":
            start = d.get("reference_column") or d.get("reference_date")
            end = d.get("reference_column_end") or d.get("reference_date_end")
            return f" range [{start}, {end}]"
        ref = d.get("reference_column") or d.get("reference_date")
        return f" {op} {ref}"
    if d.get("logic_mode") == "calculation":
        return f" {d.get('calculation_type')} check"
    return ""


def render_constraint_label_en(describe_data: dict[str, Any] | None) -> str | None:
    """把结构化约束描述渲染为英文标签；无法渲染时返回 None（调用方回退 description）。

    Args:
        describe_data: 约束的 describe_data() 结构（至少含 kind），可为 None

    Returns:
        英文标签（如 "NotNull: orders.order_id"）；未知 kind / 关键字段缺失为 None
    """
    if not isinstance(describe_data, dict):
        return None
    kind = describe_data.get("kind")
    table = describe_data.get("table")
    try:
        if kind == "NotNull" and table is not None and "column" in describe_data:
            return f"NotNull: {table}.{describe_data['column']}"
        if kind == "Unique" and table is not None and describe_data.get("columns"):
            cols = ", ".join(map(str, describe_data["columns"]))
            return f"Unique: {table}.{cols}"
        if kind == "AllowedValues" and table is not None and "column" in describe_data:
            preview = _allowed_values_preview(describe_data.get("allowed_values") or [])
            return f"AllowedValues: {table}.{describe_data['column']} allowed {preview}"
        if kind == "Range" and table is not None and "column" in describe_data:
            suffix = _range_suffix(describe_data)
            base = f"Range: {table}.{describe_data['column']}"
            return f"{base} {suffix}" if suffix else base
        if kind == "ForeignKey" and all(
            describe_data.get(k) is not None for k in ("from_table", "from_column", "to_table", "to_column")
        ):
            return (
                f"ForeignKey: {describe_data['from_table']}.{describe_data['from_column']} "
                f"-> {describe_data['to_table']}.{describe_data['to_column']}"
            )
        if kind == "Regex" and table is not None and "column" in describe_data:
            return f"Regex: {table}.{describe_data['column']} pattern={describe_data.get('pattern')!r}"
        if kind == "Charset" and table is not None and "column" in describe_data:
            name = _CHARSET_NAMES_EN.get(describe_data.get("charset_mode"), "unknown")
            return f"Charset: {table}.{describe_data['column']} ({name})"
        if kind == "Scripted" and table is not None:
            return f"Scripted: {table}.{describe_data.get('name')}"
        if kind == "Conditional" and table is not None:
            then_clause = _conditional_then_clause(describe_data.get("then"))
            then_col = describe_data.get("then_column")
            if describe_data.get("if_conditions"):
                return f"Conditional: {table} when the condition holds, {then_col} must {then_clause}"
            return (
                f"Conditional: {table} when {describe_data.get('if_column')}={describe_data.get('if_value')}, "
                f"{then_col} must {then_clause}"
            )
        if kind == "DateLogic" and table is not None and "column" in describe_data:
            return f"DateLogic: {table}.{describe_data['column']}{_date_logic_suffix(describe_data)}"
        if kind == "Composite":
            return f"Composite (logic={describe_data.get('logic')}, {describe_data.get('sub_count')} sub-constraints)"
    except Exception:
        # 渲染安全网：任何拼接异常都回退 None，不得让摘要崩溃
        return None
    return None
