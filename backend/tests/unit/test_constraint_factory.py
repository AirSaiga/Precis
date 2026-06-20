"""
@fileoverview 约束工厂和注册表单元测试

测试 constraint factory 的 create_constraint、create_constraints
以及 registry 的 normalize_constraint_type、filter_kwargs_for_class、
get_supported_constraint_types。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


from app.shared.core.project.constraint.factory import create_constraint, create_constraints
from app.shared.core.project.constraint.registry import (
    filter_kwargs_for_class,
    get_supported_constraint_types,
    normalize_constraint_type,
)
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile


class TestNormalizeConstraintType:
    def test_standard_name(self):
        assert normalize_constraint_type("Unique") == "Unique"
        assert normalize_constraint_type("NotNull") == "NotNull"

    def test_alias_lowercase(self):
        assert normalize_constraint_type("unique") == "Unique"
        assert normalize_constraint_type("not_null") == "NotNull"
        assert normalize_constraint_type("allowed_values") == "AllowedValues"

    def test_alias_camelcase(self):
        assert normalize_constraint_type("notnull") == "NotNull"
        assert normalize_constraint_type("foreignkey") == "ForeignKey"

    def test_unknown_returns_input(self):
        assert normalize_constraint_type("UnknownType") == "UnknownType"

    def test_whitespace_trim(self):
        assert normalize_constraint_type("  unique  ") == "Unique"


class TestFilterKwargsForClass:
    def test_filter_extra_args(self):
        class Dummy:
            def __init__(self, table, column):
                self.table = table
                self.column = column

        kwargs = {"table": "users", "column": "email", "extra": "ignored"}
        result = filter_kwargs_for_class(Dummy, kwargs)
        assert result == {"table": "users", "column": "email"}

    def test_no_filter_needed(self):
        class Dummy:
            def __init__(self, table):
                pass

        kwargs = {"table": "users"}
        assert filter_kwargs_for_class(Dummy, kwargs) == kwargs

    def test_empty_kwargs(self):
        class Dummy:
            def __init__(self, table):
                pass

        assert filter_kwargs_for_class(Dummy, {}) == {}


class TestGetSupportedConstraintTypes:
    def test_returns_dict(self):
        result = get_supported_constraint_types()
        assert isinstance(result, dict)
        assert "Unique" in result
        assert "NotNull" in result
        assert "Charset" in result


def _make_schema_files():
    return {
        "users": TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="email", name="email", type="string"),
                ColumnSpec(id="age", name="age", type="integer"),
                ColumnSpec(id="gender", name="gender", type="string"),
            ],
        ),
        "orders": TableSchemaFile(
            version=2,
            id="orders",
            name="orders",
            columns=[
                ColumnSpec(id="user_id", name="user_id", type="string"),
                ColumnSpec(id="amount", name="amount", type="decimal"),
            ],
        ),
    }


class TestCreateConstraint:
    def test_disabled_constraint(self):
        cf = ConstraintFile(
            version=2, id="c1", type="Unique", enabled=False, refs={"table_id": "users", "column_ids": ["email"]}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert error is None

    def test_unsupported_type(self):
        cf = ConstraintFile.model_construct(version=2, id="c1", type="UnknownType", enabled=True, refs={})
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "不支持" in error

    def test_missing_table(self):
        cf = ConstraintFile(
            version=2, id="c1", type="Unique", enabled=True, refs={"table_id": "nonexistent", "column_ids": ["email"]}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "不存在" in error

    def test_unique_single_column(self):
        cf = ConstraintFile(
            version=2, id="c1", type="Unique", enabled=True, refs={"table_id": "users", "column_ids": ["email"]}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result is not None
        assert result.table == "users"
        assert result.columns == ["email"]

    def test_unique_string_column_id(self):
        cf = ConstraintFile(
            version=2, id="c1", type="Unique", enabled=True, refs={"table_id": "users", "column_id": "email"}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.columns == ["email"]

    def test_unique_invalid_column(self):
        cf = ConstraintFile(
            version=2, id="c1", type="Unique", enabled=True, refs={"table_id": "users", "column_ids": ["nonexistent"]}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "引用的列不存在" in error

    def test_not_null_success(self):
        cf = ConstraintFile(
            version=2, id="c1", type="NotNull", enabled=True, refs={"table_id": "users", "column_id": "email"}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.table == "users"
        assert result.column == "email"

    def test_not_null_missing_table_id(self):
        cf = ConstraintFile(version=2, id="c1", type="NotNull", enabled=True, refs={"column_id": "email"})
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "缺少 table_id" in error

    def test_not_null_missing_column_id(self):
        cf = ConstraintFile(version=2, id="c1", type="NotNull", enabled=True, refs={"table_id": "users"})
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "缺少 column_id" in error

    def test_not_null_invalid_column(self):
        cf = ConstraintFile(
            version=2, id="c1", type="NotNull", enabled=True, refs={"table_id": "users", "column_id": "no_col"}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "不存在" in error

    def test_allowed_values_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="AllowedValues",
            enabled=True,
            refs={"table_id": "users", "column_id": "gender"},
            params={"allowed_values": ["男", "女"]},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.allowed_values == ["男", "女"]

    def test_foreign_key_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="ForeignKey",
            enabled=True,
            refs={
                "from_table_id": "orders",
                "from_column_id": "user_id",
                "to_table_id": "users",
                "to_column_id": "email",
            },
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.from_table == "orders"
        assert result.from_column == "user_id"
        assert result.to_table == "users"
        assert result.to_column == "email"

    def test_foreign_key_missing_from_table(self):
        cf = ConstraintFile(
            version=2, id="c1", type="ForeignKey", enabled=True, refs={"to_table_id": "users", "to_column_id": "email"}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "缺少必要的表引用" in error

    def test_foreign_key_invalid_column(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="ForeignKey",
            enabled=True,
            refs={"from_table_id": "orders", "from_column_id": "bad", "to_table_id": "users", "to_column_id": "email"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "不存在" in error

    def test_conditional_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Conditional",
            enabled=True,
            refs={
                "table_id": "users",
                "then_column_id": "gender",
                "if_conditions": [{"if_column_id": "age", "operator": ">", "value": 18}],
                "if_logic": "and",
            },
            params={"then_condition": "is_not_empty"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.table == "users"
        assert result.then_column == "gender"
        assert result.if_logic == "and"

    def test_conditional_missing_then_column(self):
        cf = ConstraintFile(version=2, id="c1", type="Conditional", enabled=True, refs={"table_id": "users"})
        result, error = create_constraint(cf, _make_schema_files())
        assert result is None
        assert "缺少 then_column_id" in error

    def test_range_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Range",
            enabled=True,
            refs={"table_id": "users", "column_id": "age"},
            params={"min": 0, "max": 100, "boundary_mode": "inclusive"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.min_value == 0
        assert result.max_value == 100

    def test_scripted_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Scripted",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
            params={"name": "check_email", "expression": "len(str(value)) > 0"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.name == "check_email"
        assert result.expression == "len(str(value)) > 0"

    def test_scripted_no_column(self):
        cf = ConstraintFile(
            version=2, id="c1", type="Scripted", enabled=True, refs={"table_id": "users"}, params={"expression": "True"}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.column is None

    def test_date_logic_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="DateLogic",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
            params={"logic_mode": "compare", "compare_op": "gt"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.logic_mode == "compare"

    def test_date_logic_range_success(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="DateLogic",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
            params={
                "logic_mode": "compare",
                "compare_op": "range",
                "reference_date": "2024-01-01",
                "reference_date_end": "2024-12-31",
            },
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result.compare_op == "range"
        assert result.reference_date == "2024-01-01"
        assert result.reference_date_end == "2024-12-31"

    def test_alias_type_name(self):
        cf = ConstraintFile.model_construct(
            version=2, id="c1", type="unique", enabled=True, refs={"table_id": "users", "column_ids": ["email"]}
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None
        assert result is not None


class TestCreateConstraints:
    def test_batch_create(self):
        files = {
            "c1": ConstraintFile(
                version=2, id="c1", type="Unique", enabled=True, refs={"table_id": "users", "column_ids": ["email"]}
            ),
            "c2": ConstraintFile(
                version=2, id="c2", type="NotNull", enabled=True, refs={"table_id": "users", "column_id": "age"}
            ),
        }
        constraints, warnings = create_constraints(files, _make_schema_files())
        assert len(constraints) == 2
        assert len(warnings) == 0

    def test_skips_disabled(self):
        files = {
            "c1": ConstraintFile(version=2, id="c1", type="Unique", enabled=False, refs={}),
        }
        constraints, warnings = create_constraints(files, _make_schema_files())
        assert len(constraints) == 0
        assert len(warnings) == 0

    def test_collects_warnings(self):
        files = {
            "c1": ConstraintFile.model_construct(version=2, id="c1", type="BadType", enabled=True, refs={}),
        }
        constraints, warnings = create_constraints(files, _make_schema_files())
        assert len(constraints) == 0
        assert len(warnings) == 1
        assert "c1" in warnings[0]

    def test_exception_handling(self):
        # Monkey-patch create_constraint to raise inside create_constraints
        import app.shared.core.project.constraint.factory as factory_module

        original = factory_module.create_constraint
        try:

            def _bad_create(*args, **kwargs):
                raise RuntimeError("boom")

            factory_module.create_constraint = _bad_create
            files = {
                "c1": ConstraintFile(version=2, id="c1", type="Unique", enabled=True, refs={}),
            }
            constraints, warnings = create_constraints(files, _make_schema_files())
            assert len(constraints) == 0
            assert len(warnings) == 1
            assert "boom" in warnings[0]
        finally:
            factory_module.create_constraint = original
