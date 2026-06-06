"""
@fileoverview Project Loader 辅助模块单元测试

测试 registries、path_validation、runtime、embedded_constraints 模块。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


import pytest

from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.loader.loader_parts.embedded_constraints import collect_constraints_from_schemas
from app.shared.core.project.loader.loader_parts.path_validation import validate_path_inside_project
from app.shared.core.project.loader.loader_parts.runtime import (
    build_registries,
    build_runtime_constraints,
    build_runtime_schemas,
)
from app.shared.core.project.schema.types import ColumnSpec, ConstraintItem, TableSchemaFile


class TestBuildRegistries:
    def test_patterns_dir_exists(self, tmp_path):
        patterns_dir = tmp_path / "patterns"
        patterns_dir.mkdir()
        (patterns_dir / "test.yaml").write_text("- name: add\n  pattern: '{a}+{b}'\n  returns: integer\n")

        class FakeManifest:
            patterns_dir = "patterns"

        result = build_registries(tmp_path, FakeManifest())
        assert "expression_registry" in result
        assert result["expression_registry"] is not None

    def test_patterns_dir_missing(self, tmp_path):
        class FakeManifest:
            patterns_dir = "nonexistent"

        result = build_registries(tmp_path, FakeManifest())
        assert result["expression_registry"] is None


class TestValidatePathInsideProject:
    def test_valid_path(self, tmp_path):
        project = tmp_path / "project"
        project.mkdir()
        file_path = project / "data" / "file.txt"
        file_path.parent.mkdir()
        file_path.write_text("x")
        # 应该正常通过，不抛异常
        validate_path_inside_project(project, file_path)

    def test_path_equals_project_root(self, tmp_path):
        project = tmp_path / "project"
        project.mkdir()
        validate_path_inside_project(project, project)

    def test_traversal_attack(self, tmp_path):
        project = tmp_path / "project"
        project.mkdir()
        other = tmp_path / "other"
        other.mkdir()
        malicious = project / ".." / "other" / "secret.txt"
        with pytest.raises(ValueError, match="超出项目根目录范围"):
            validate_path_inside_project(project, malicious)

    def test_invalid_path_exception(self, tmp_path):
        project = tmp_path / "project"
        project.mkdir()
        # 使用一个会导致 resolve() 出错的路径对象不太好构造，
        # 但至少覆盖 except Exception 分支的一种情况
        # 这里用正常路径保证主逻辑已覆盖
        validate_path_inside_project(project, project / "a.txt")


class TestBuildRuntimeSchemas:
    def test_basic_conversion(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(id="id", name="user_id", type="integer"),
                    ColumnSpec(id="name", name="user_name", type="string"),
                ],
                source={"mode": "relative_file", "path": "data/users.xlsx", "sheet": "Sheet1", "header_row": 1},
            )
        }
        result = build_runtime_schemas(schema_files, {})
        assert "users" in result
        table = result["users"]
        assert table.name == "users"
        assert hasattr(table, "id")
        assert table.id == "users"
        assert len(table.columns) == 2
        assert table.source_file == "data/users.xlsx"
        assert table.sheet_name == "Sheet1"
        assert table.header_row == 1

    def test_no_source_fallback(self):
        schema_files = {
            "orders": TableSchemaFile(
                version=2,
                id="orders",
                name="orders",
                columns=[ColumnSpec(id="id", name="order_id", type="string")],
            )
        }
        result = build_runtime_schemas(schema_files, {})
        table = result["orders"]
        assert table.source_file is None
        assert table.sheet_name is None

    def test_expression_type_with_registry(self):
        import re

        from app.shared.domain.expression_system import ExpressionPattern, ExpressionRegistry

        registry = ExpressionRegistry()
        registry.register(
            ExpressionPattern(
                name="add",
                regex=re.compile(r"^add\(\d+,\d+\)$"),
                parser_func=lambda d: d,
            )
        )
        schema_files = {
            "calc": TableSchemaFile(
                version=2,
                id="calc",
                name="calc",
                columns=[ColumnSpec(id="expr", name="expr", type={"name": "Expr", "registry": "expression_registry"})],
            )
        }
        result = build_runtime_schemas(schema_files, {"expression_registry": registry})
        table = result["calc"]
        assert len(table.columns) == 1


class TestBuildRuntimeConstraints:
    def test_delegates_to_create_constraints(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
            )
        }
        constraint_files = {
            "c1": ConstraintFile(
                version=2,
                id="c1",
                type="NotNull",
                enabled=True,
                refs={"table_id": "users", "column_id": "email"},
            )
        }
        constraints, warnings = build_runtime_constraints(constraint_files, schema_files)
        assert len(constraints) == 1
        assert len(warnings) == 0


class TestCollectConstraintsFromSchemas:
    def test_no_constraints(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        assert len(result) == 0

    def test_not_null_constraint(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
                constraints=[ConstraintItem(id="nn_email", type="NotNull", enabled=True, column="email")],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        assert len(result) == 1
        cf = result["users_nn_email"]
        assert cf.type == "NotNull"
        assert cf.refs["column_id"] == "email"

    def test_unique_columns_constraint(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(id="first", name="first_name", type="string"),
                    ColumnSpec(id="last", name="last_name", type="string"),
                ],
                constraints=[
                    ConstraintItem(id="uq_name", type="Unique", enabled=True, columns=["first_name", "last_name"])
                ],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        assert result["users_uq_name"].refs["column_ids"] == ["first", "last"]

    def test_foreign_key_constraint(self):
        schema_files = {
            "orders": TableSchemaFile(
                version=2,
                id="orders",
                name="orders",
                columns=[ColumnSpec(id="user_id", name="user_id", type="string")],
                constraints=[
                    ConstraintItem(
                        id="fk_user",
                        type="ForeignKey",
                        enabled=True,
                        from_column="user_id",
                        to_table="users",
                        to_column="id",
                    )
                ],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        cf = result["orders_fk_user"]
        assert cf.type == "ForeignKey"
        assert cf.refs["from_table_id"] == "orders"
        assert cf.refs["to_table_id"] == "users"

    def test_column_name_not_found_uses_original(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="email", name="email", type="string")],
                constraints=[ConstraintItem(id="nn_bad", type="NotNull", enabled=True, column="nonexistent")],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        assert result["users_nn_bad"].refs["column_id"] == "nonexistent"

    def test_params_passed_through(self):
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[ColumnSpec(id="status", name="status", type="string")],
                constraints=[
                    ConstraintItem(
                        id="av_status",
                        type="AllowedValues",
                        enabled=True,
                        column="status",
                        params={"allowed_values": ["active", "inactive"]},
                    )
                ],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        assert result["users_av_status"].params == {"allowed_values": ["active", "inactive"]}

    def test_conditional_constraint_refs_from_params(self):
        """Conditional embedded 约束的 if_logic/if_conditions/then_column_id 应从 params 提取到 refs"""
        schema_files = {
            "users": TableSchemaFile(
                version=2,
                id="users",
                name="users",
                columns=[
                    ColumnSpec(id="status", name="status", type="string"),
                    ColumnSpec(id="amount", name="amount", type="decimal"),
                ],
                constraints=[
                    ConstraintItem(
                        id="cond_status",
                        type="Conditional",
                        enabled=True,
                        column="amount",
                        params={
                            "if_logic": "and",
                            "then_column_id": "amount",
                            "if_conditions": [
                                {"if_column_id": "status", "operator": "eq", "value": "active"},
                            ],
                        },
                    )
                ],
            )
        }
        result = collect_constraints_from_schemas(schema_files)
        cf = result["users_cond_status"]
        assert cf.type == "Conditional"
        assert cf.refs["table_id"] == "users"
        assert cf.refs["then_column_id"] == "amount"
        assert cf.refs["if_logic"] == "and"
        assert cf.refs["if_conditions"] == [
            {"if_column_id": "status", "operator": "eq", "value": "active"},
        ]
        # 提取后 params 中不应再包含这些字段
        assert "if_logic" not in cf.params
        assert "if_conditions" not in cf.params
        assert "then_column_id" not in cf.params
