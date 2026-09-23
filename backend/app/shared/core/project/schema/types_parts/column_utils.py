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


def build_qualified_name_to_id_map(columns: list[ColumnSpec] | None) -> dict[str, str]:
    """递归构建 全限定列名 -> column_id 映射（约束列引用的精确解析表）。

    命名规则:顶层列键为裸名,嵌套子列键为「父.子」点分路径(与 json_normalize
    拍平后的点分列名一致)。同名冲突时保留首个(深度优先遍历序,与
    build_column_id_to_name_map 的取列顺序一致)。

    列引用解析约定(精确匹配,不做递归裸名猜测):
    - `email`           -> 仅匹配顶层列 email
    - `customer.email`  -> 仅匹配 customer 下的子列 email
    - 未命中的引用由调用方决定兜底(如原样保留视作列 ID)

    :param columns: 顶层列列表
    :return: {全限定列名: column_id},跳过 name 或 id 为 None 的列
    """
    result: dict[str, str] = {}
    _collect_name_keys(columns or [], "", result)
    return result


def _collect_name_keys(columns: list[ColumnSpec], parent_path: str, result: dict[str, str]) -> None:
    """递归收集 全限定列名 -> column_id。

    :param columns: 当前层级的列列表
    :param parent_path: 父级全限定路径(空串表示顶层)
    :param result: 累积结果的字典
    """
    prefix = f"{parent_path}." if parent_path else ""
    for col in columns:
        if col.name and col.id is not None:
            key = f"{prefix}{col.name}"
            if key not in result:
                result[key] = col.id
        if col.children:
            _collect_name_keys(col.children, f"{prefix}{col.name}" if col.name else parent_path, result)


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
