"""
@fileoverview 列递归遍历工具

提供递归处理 ColumnSpec(含嵌套 children)的工具函数。
平面 schema(无 children)行为等价于原顶层遍历,向后兼容。
"""

from __future__ import annotations

from collections.abc import Iterator

from app.shared.core.project.schema.types_parts.column import ColumnSpec


def iter_all_columns(columns: list[ColumnSpec] | None) -> Iterator[ColumnSpec]:
    """递归遍历列(含嵌套 children),深度优先优先遍历父节点本身。

    对无 children 的平面列,等价于直接遍历顶层(行为不变)。

    :param columns: 顶层列列表,可为 None
    :yield: 每个列(父 + 所有子孙),深度优先
    """
    for col in columns or []:
        yield col
        if col.children:
            yield from iter_all_columns(col.children)


def build_column_id_to_name_map(columns: list[ColumnSpec] | None) -> dict[str, str]:
    """递归构建 column_id -> column_name 映射。

    用于约束工厂解析 column_id 引用,确保嵌套子列上的约束也能命中。

    :param columns: 顶层列列表
    :return: {column_id: column_name},跳过 id 为 None 的列
    """
    return {c.id: c.name for c in iter_all_columns(columns) if c.id is not None}
