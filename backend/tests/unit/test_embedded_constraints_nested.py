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
@fileoverview 内嵌约束嵌套列引用解析测试
验证 collect_constraints_from_schemas 按全限定路径精确解析列引用:
顶层列用裸名、嵌套子列用「父.子」点分路径,不做递归裸名猜测。
"""

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.loader_parts.embedded_constraints import (
    collect_constraints_from_schemas,
)
from app.shared.core.project.loader.types import LoadingError
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
                ColumnSpec(id="profile", name="profile", type="object"),
                ColumnSpec(
                    id="address",
                    name="address",
                    type="object",
                    children=[ColumnSpec(id="address_city", name="city", type="string")],
                ),
            ],
            constraints=[
                ConstraintItem(id="nn_city", type="NotNull", column="address.city", enabled=True),
            ],
        ),
    }


class TestCollectConstraintsNested:
    def test_embedded_notnull_on_nested_child_resolves_id(self):
        """嵌套子列应使用「父.子」全限定路径引用,解析为 address_city。"""
        result = collect_constraints_from_schemas(_make_schema_with_nested_embedded())
        assert "users_nn_city" in result
        cf: ConstraintFile = result["users_nn_city"]
        assert cf.refs["column_id"] == "address_city", (
            f"全限定路径 address.city 应解析为 address_city,实际: {cf.refs.get('column_id')}"
        )

    def test_nested_bare_name_is_not_recursively_resolved(self):
        """裸名引用不做递归猜测:嵌套子列的裸名(无顶层同名列)解析失败 → 报错并丢弃该约束。"""
        errors: list[LoadingError] = []
        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(
                        id="profile",
                        name="profile",
                        type="object",
                        children=[ColumnSpec(id="profile_email", name="email", type="string")],
                    ),
                ],
                constraints=[ConstraintItem(id="nn", type="NotNull", column="email", enabled=True)],
            ),
        }
        result = collect_constraints_from_schemas(schemas, errors)
        # "email" 只匹配顶层列;此处顶层无 email → 约束被丢弃且结构化报错
        assert "users_nn" not in result
        assert len(errors) == 1
        assert errors[0].error_type == "EmbeddedColumnRefError"
        assert errors[0].ref_id == "users_nn"
        assert "email" in errors[0].message

    def test_bare_name_binds_top_level_when_nested_duplicate_exists(self):
        """顶层与嵌套列同名时,裸名精确绑定顶层列,嵌套列必须用路径引用。"""
        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(id="email", name="email", type="string"),
                    ColumnSpec(
                        id="customer",
                        name="customer",
                        type="object",
                        children=[ColumnSpec(id="customer_email", name="email", type="string")],
                    ),
                ],
                constraints=[
                    ConstraintItem(id="nn_top", type="NotNull", column="email", enabled=True),
                    ConstraintItem(id="nn_nested", type="NotNull", column="customer.email", enabled=True),
                ],
            ),
        }
        result = collect_constraints_from_schemas(schemas)
        assert result["users_nn_top"].refs["column_id"] == "email"
        assert result["users_nn_nested"].refs["column_id"] == "customer_email"

    def test_column_id_reference_is_rejected(self):
        """列 ID 写进名称字段是错误写法:约束被丢弃并结构化报错,不兜底直通。"""
        errors: list[LoadingError] = []
        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(
                        id="customer",
                        name="customer",
                        type="object",
                        children=[ColumnSpec(id="customer_email", name="email", type="string")],
                    ),
                ],
                constraints=[ConstraintItem(id="nn", type="NotNull", column="customer_email", enabled=True)],
            ),
        }
        result = collect_constraints_from_schemas(schemas, errors)
        assert "users_nn" not in result
        assert len(errors) == 1
        assert errors[0].error_type == "EmbeddedColumnRefError"

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

    def test_multi_columns_resolve(self):
        """多列引用逐个按全限定名解析。"""
        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(
                        id="customer",
                        name="customer",
                        type="object",
                        children=[
                            ColumnSpec(id="customer_first", name="first", type="string"),
                            ColumnSpec(id="customer_last", name="last", type="string"),
                        ],
                    ),
                ],
                constraints=[
                    ConstraintItem(id="uq", type="Unique", columns=["customer.first", "customer.last"], enabled=True)
                ],
            ),
        }
        result = collect_constraints_from_schemas(schemas)
        assert result["users_uq"].refs["column_ids"] == ["customer_first", "customer_last"]

    def test_multi_columns_rejects_unresolvable(self):
        """多列引用中任一列无法解析 → 整条约束丢弃并报错。"""
        errors: list[LoadingError] = []
        schemas = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="a", name="a", type="string")],
                constraints=[ConstraintItem(id="uq", type="Unique", columns=["a", "nope"], enabled=True)],
            ),
        }
        result = collect_constraints_from_schemas(schemas, errors)
        assert "users_uq" not in result
        assert len(errors) == 1
        assert "nope" in errors[0].message
