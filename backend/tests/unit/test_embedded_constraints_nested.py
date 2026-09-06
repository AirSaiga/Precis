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
@fileoverview 内嵌约束嵌套列解析测试
验证 collect_constraints_from_schemas 能从嵌套子列名解析回 column_id。
"""

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.loader_parts.embedded_constraints import (
    collect_constraints_from_schemas,
)
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
from app.shared.core.project.schema.types_parts.constraint import ConstraintItem


def _make_schema_with_nested_embedded():
    """schema 含嵌套列 + 挂在子列上的内嵌 notNull 约束。"""
    return {
        "users": TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(
                    id="profile",
                    name="profile",
                    type="object",
                    children=[
                        ColumnSpec(
                            id="address",
                            name="address",
                            type="object",
                            children=[ColumnSpec(id="address_city", name="city", type="string")],
                        ),
                    ],
                ),
            ],
            constraints=[
                ConstraintItem(id="nn_city", type="NotNull", column="city", enabled=True),
            ],
        ),
    }


class TestCollectConstraintsNested:
    def test_embedded_notnull_on_nested_child_resolves_id(self):
        """内嵌 NotNull 挂在嵌套子列 city 上,应解析为 address_city 而非保留 "city"。"""
        result = collect_constraints_from_schemas(_make_schema_with_nested_embedded())
        assert "users_nn_city" in result
        cf: ConstraintFile = result["users_nn_city"]
        assert cf.refs["column_id"] == "address_city", (
            f"嵌套子列名 city 应解析为 address_city,实际: {cf.refs.get('column_id')}"
        )

    def test_flat_embedded_still_resolves(self):
        """回归:平面列内嵌约束仍正确解析。"""
        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
                constraints=[ConstraintItem(id="nn", type="NotNull", column="email", enabled=True)],
            ),
        }
        result = collect_constraints_from_schemas(schemas)
        assert result["users_nn"].refs["column_id"] == "email"
