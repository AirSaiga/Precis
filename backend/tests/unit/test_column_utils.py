"""
@fileoverview 递归列遍历工具单元测试
验证 iter_all_columns / build_column_id_to_name_map 能递归处理嵌套 children。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.project.schema.types import ColumnSpec
from app.shared.core.project.schema.types_parts.column_utils import (
    build_column_id_to_name_map,
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
            "user_name": "name",
            "address": "address",
            "address_city": "city",
            "address_zip": "zip",
        }

    def test_skips_none_id(self):
        # ColumnSpec 允许 id 为 None(validator 会用 name 补全,但绕过验证时可能为 None)
        col = ColumnSpec.model_construct(name="x", type="string")  # 无 id
        result = build_column_id_to_name_map([col])
        assert result == {}
