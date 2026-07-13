"""@fileoverview Unique 约束构建器

Unique 的 column 支持 list 语义（多列联合唯一），与其他单列约束不同，需独立构建器。
"""

from __future__ import annotations

from typing import Any

from .base import BuilderInput, BuilderResult
from .registry import register_builder


@register_builder("Unique")
def build_unique(inp: BuilderInput) -> BuilderResult:
    """Unique: refs {table_id, column_ids | column_id}。

    column_ids 支持列表（多列）或字符串（单列兼容）。
    """
    refs = inp.refs
    table_id = refs.get("table_id")
    col_id = refs.get("column_ids") or refs.get("column_id")
    if not isinstance(table_id, str):
        return {}, "缺少 table_id"
    # 确保 col_id 是列表
    if isinstance(col_id, str):
        col_id = [col_id]
    elif not col_id:
        col_id = []

    kwargs: dict[str, Any] = {"table": table_id}
    # 映射 column_ids -> column_names
    mapped_cols = [inp.column_name_by_table_id.get(table_id, {}).get(str(cid)) for cid in col_id]
    if None in mapped_cols:
        invalid_cols = [cid for cid, name in zip(col_id, mapped_cols) if name is None]
        return {}, f"引用的列不存在: {invalid_cols}"
    kwargs["column"] = mapped_cols
    return kwargs, None
