"""@fileoverview ForeignKey 约束构建器

双向引用（from/to 两端表+列），与其他单端约束不同。
"""

from __future__ import annotations

from .base import BuilderInput, BuilderResult
from .registry import register_builder


@register_builder("ForeignKey")
def build_foreign_key(inp: BuilderInput) -> BuilderResult:
    """ForeignKey: refs {from_table_id, from_column_id, to_table_id, to_column_id}。"""
    refs = inp.refs
    from_table_id = refs.get("from_table_id")
    from_col_id = refs.get("from_column_id")
    to_table_id = refs.get("to_table_id")
    to_col_id = refs.get("to_column_id")

    if from_table_id is None or to_table_id is None:
        return {}, "缺少必要的表引用"

    from_col_name = inp.column_name_by_table_id.get(from_table_id, {}).get(str(from_col_id))
    to_col_name = inp.column_name_by_table_id.get(to_table_id, {}).get(str(to_col_id))

    if from_col_name is None:
        return {}, f"引用的列 '{from_col_id}' 不存在于表 '{from_table_id}' 中"
    if to_col_name is None:
        return {}, f"引用的列 '{to_col_id}' 不存在于表 '{to_table_id}' 中"

    return {
        "from_table": from_table_id,
        "from_column": from_col_name,
        "to_table": to_table_id,
        "to_column": to_col_name,
    }, None
