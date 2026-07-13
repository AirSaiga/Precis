"""@fileoverview Scripted 约束构建器

column_id 可选（表达式可不绑定到具体列）。
"""

from __future__ import annotations

from .base import BuilderInput, BuilderResult
from .registry import register_builder


@register_builder("Scripted")
def build_scripted(inp: BuilderInput) -> BuilderResult:
    """Scripted: refs {table_id, column_id?}，params {name, expression}。"""
    refs = inp.refs
    table_id = refs.get("table_id")
    col_id = refs.get("column_id")

    kwargs: dict[str, object] = {"table": table_id}
    # 使用约束 ID 作为默认名称
    kwargs["name"] = inp.params.get("name", inp.const_id)
    kwargs["expression"] = inp.params.get("expression", "")
    # column_id 是可选的
    if col_id and isinstance(table_id, str):
        kwargs["column"] = inp.column_name_by_table_id.get(table_id, {}).get(str(col_id))

    return kwargs, None  # type: ignore[return-value]
