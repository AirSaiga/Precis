"""@fileoverview Conditional 约束构建器

THEN 列 + IF 条件列表逐项映射。条件列支持回退用 column_id（transform 派生列不在 schema 中）。
"""

from __future__ import annotations

from typing import Any

from .base import BuilderInput, BuilderResult
from .registry import register_builder


@register_builder("Conditional")
def build_conditional(inp: BuilderInput) -> BuilderResult:
    """Conditional: refs {table_id, then_column_id, if_conditions, if_logic}，params {then_condition}。"""
    refs = inp.refs
    table_id = refs.get("table_id")
    then_col_id = refs.get("then_column_id")
    if table_id is None:
        return {}, "缺少 table_id"
    if then_col_id is None:
        return {}, "缺少 then_column_id"
    if_logic = refs.get("if_logic", "and")
    if_conditions = refs.get("if_conditions") or []

    col_map = inp.column_name_by_table_id.get(table_id, {})
    # 列名映射：优先从 schema 查找，找不到则直接使用 column_id
    # （支持 transform 生成的派生列，这些列不在原始 schema 中）
    then_col_name = col_map.get(then_col_id) or then_col_id

    # 处理 IF 条件列表，将 column_id 映射为 column_name
    normalized_conditions: list[dict[str, Any]] = []
    for cond in if_conditions:
        if_col_id = cond.get("if_column_id")
        if_col_name = col_map.get(if_col_id) or if_col_id
        normalized_conditions.append(
            {
                "if_column": if_col_name,
                "operator": cond.get("operator", "eq"),
                "value": cond.get("value"),
                "values": cond.get("values"),
            }
        )

    return {
        "table": table_id,
        "then_column": then_col_name,
        "then_condition": inp.params.get("then_condition"),
        "if_conditions": normalized_conditions,
        "if_logic": if_logic,
    }, None
