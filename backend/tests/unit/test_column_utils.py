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
@fileoverview 递归列遍历工具单元测试
验证 iter_all_columns / build_column_id_to_name_map / build_qualified_name_to_id_map
能递归处理嵌套 children。
"""

from app.shared.core.project.schema.types import ColumnSpec
from app.shared.core.project.schema.types_parts.column_utils import (
    build_column_id_to_name_map,
    build_qualified_name_to_id_map,
    iter_all_columns,
)


def _make_nested_columns():
    """构造含 2 层嵌套的列:顶层 user(对象) + 顶层 age,children 含 address.city/address.zip"""
    return [
        ColumnSpec(id="age", name="age", type="integer"),
        ColumnSpec(
            id="user",
            name="user",
            type="object",
            children=[
                ColumnSpec(id="user_name", name="name", type="string"),
                ColumnSpec(
                    id="address",
                    name="address",
                    type="object",
                    children=[
                        ColumnSpec(id="address_city", name="city", type="string"),
                        ColumnSpec(id="address_zip", name="zip", type="string"),
                    ],
                ),
            ],
        ),
    ]


class TestIterAllColumns:
    def test_flat_columns_no_children(self):
        cols = [ColumnSpec(id="a", name="a", type="string")]
        names = [c.name for c in iter_all_columns(cols)]
        assert names == ["a"]

    def test_nested_columns_recursive(self):
        names = [c.name for c in iter_all_columns(_make_nested_columns())]
        # 深度优先: age, user, name, address, city, zip
        assert names == ["age", "user", "name", "address", "city", "zip"]

    def test_empty_or_none(self):
        assert list(iter_all_columns([])) == []
        assert list(iter_all_columns(None)) == []  # type: ignore[arg-type]


class TestBuildColumnIdToNameMap:
    def test_flat_map(self):
        cols = [ColumnSpec(id="a", name="name_a", type="string")]
        assert build_column_id_to_name_map(cols) == {"a": "name_a"}

    def test_nested_map_includes_children(self):
        result = build_column_id_to_name_map(_make_nested_columns())
        assert result == {
            "age": "age",
            "user": "user",
            "user_name": "user.name",
            "address": "user.address",
            "address_city": "user.address.city",
            "address_zip": "user.address.zip",
        }

    def test_flat_map_still_works(self):
        """平面列(无 children)映射为自身名,向后兼容。"""
        cols = [ColumnSpec(id="a", name="name_a", type="string")]
        assert build_column_id_to_name_map(cols) == {"a": "name_a"}

    def test_deeply_nested_qualified_name(self):
        """3 层嵌套叶子列应生成完整全限定名。"""
        cols = [
            ColumnSpec(
                id="root",
                name="root",
                type="object",
                children=[
                    ColumnSpec(
                        id="mid",
                        name="mid",
                        type="object",
                        children=[ColumnSpec(id="leaf", name="leaf", type="string")],
                    ),
                ],
            ),
        ]
        result = build_column_id_to_name_map(cols)
        assert result == {
            "root": "root",
            "mid": "root.mid",
            "leaf": "root.mid.leaf",
        }

    def test_skips_none_id(self):
        # ColumnSpec 允许 id 为 None(validator 会用 name 补全,但绕过验证时可能为 None)
        col = ColumnSpec.model_construct(name="x", type="string")  # 无 id
        result = build_column_id_to_name_map([col])
        assert result == {}


class TestBuildQualifiedNameToIdMap:
    def test_top_level_uses_bare_name(self):
        """顶层列键为裸名。"""
        cols = [ColumnSpec(id="email", name="email", type="string")]
        assert build_qualified_name_to_id_map(cols) == {"email": "email"}

    def test_nested_children_use_dotted_path(self):
        """嵌套子列键为「父.子」点分路径,顶层同名不受影响。"""
        result = build_qualified_name_to_id_map(_make_nested_columns())
        assert result == {
            "age": "age",
            "user": "user",
            "user.name": "user_name",
            "user.address": "address",
            "user.address.city": "address_city",
            "user.address.zip": "address_zip",
        }

    def test_duplicate_names_keeps_first(self):
        """同名键(如两个对象列下都有 name)保留深度优先首个,行为与 id->name 映射一致。"""
        cols = [
            ColumnSpec(
                id="a",
                name="a",
                type="object",
                children=[ColumnSpec(id="a_name", name="name", type="string")],
            ),
            ColumnSpec(
                id="b",
                name="b",
                type="object",
                children=[ColumnSpec(id="b_name", name="name", type="string")],
            ),
        ]
        result = build_qualified_name_to_id_map(cols)
        assert result["a.name"] == "a_name"
        assert result["b.name"] == "b_name"
        # 顶层同名(重名列)保留首个
        dup = [
            ColumnSpec(id="x1", name="dup", type="string"),
            ColumnSpec(id="x2", name="dup", type="string"),
        ]
        assert build_qualified_name_to_id_map(dup) == {"dup": "x1"}

    def test_empty_or_none(self):
        assert build_qualified_name_to_id_map([]) == {}
        assert build_qualified_name_to_id_map(None) == {}  # type: ignore[arg-type]
