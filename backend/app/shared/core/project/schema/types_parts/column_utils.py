"""
@fileoverview 列递归遍历工具

提供递归处理 ColumnSpec(含嵌套 children)的工具函数。
平面 schema(无 children)行为等价于原顶层遍历,向后兼容。
"""

from __future__ import annotations

from collections.abc import Iterator

from app.shared.core.project.schema.types_parts.column import ColumnSpec


def iter_all_columns(columns: list[ColumnSpec] | None) -> Iterator[ColumnSpec]:
    """递归遍历列(含嵌套 children),深度优先遍历父节点本身。

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

    嵌套子列用「父.子」全限定名(与 json_normalize 展平后的点分列一致),
    使约束能直接 df['profile.name'] 取值。
    平面列(无父)映射为自身名。

    :param columns: 顶层列列表
    :return: {column_id: 全限定列名},跳过 id 为 None 的列
    """
    result: dict[str, str] = {}
    _collect_qualified_names(columns or [], "", result)
    return result


def _collect_qualified_names(columns: list[ColumnSpec], parent_path: str, result: dict[str, str]) -> None:
    """递归收集 column_id -> 全限定列名。

    :param columns: 当前层级的列列表
    :param parent_path: 父级全限定路径(空串表示顶层)
    :param result: 累积结果的字典
    """
    prefix = f"{parent_path}." if parent_path else ""
    for col in columns:
        qualified_name = f"{prefix}{col.name}"
        if col.id is not None:
            result[col.id] = qualified_name
        if col.children:
            _collect_qualified_names(col.children, qualified_name, result)
