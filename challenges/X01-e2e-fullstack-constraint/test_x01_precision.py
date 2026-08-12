"""X01 — Precision 约束全链路测试（真实仓库后端）。

覆盖：类实现、validate 行为（含边缘）、类型注册表、别名、构建器注册表、
配置模型枚举、端到端工厂构建、兼容导出层（含 __all__ 陷阱锁定）。
本文件由 verify.py 复制到 backend/tests/unit/test_x01_precision.py 运行。
"""

from __future__ import annotations

from decimal import Decimal

import pandas as pd
import pytest

import app.shared.domain.validation_constraints as vc
from app.shared.core.project.constraint.factory import create_constraint
from app.shared.core.project.constraint.registry import (
    CONSTRAINT_REGISTRY,
    get_supported_constraint_types,
    normalize_constraint_type,
    resolve_constraint_class,
)
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
from app.shared.domain import constraints as domain_constraints
from app.shared.domain.constraints.base import Constraint
from app.shared.domain.constraints.precision import PrecisionConstraint


def _make_schema_files() -> dict[str, TableSchemaFile]:
    """构造最小 schema，供工厂构建约束时解析 table_id / column_id。"""
    return {
        "users": TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="amount", name="amount", type="decimal"),
                ColumnSpec(id="code", name="code", type="string"),
            ],
        ),
    }


# ============================================================================
# 1. 类实现：继承、构造、属性、参数校验
# ============================================================================


class TestPrecisionConstraintClass:
    def test_inherits_constraint(self):
        assert issubclass(PrecisionConstraint, Constraint)

    def test_constructor_accepts_three_params(self):
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        assert isinstance(c, Constraint)

    def test_attributes_stored(self):
        c = PrecisionConstraint(table="users", column="amount", precision=3)
        assert c.table == "users"
        assert c.column == "amount"
        assert c.precision == 3

    def test_negative_precision_rejected(self):
        with pytest.raises(ValueError):
            PrecisionConstraint(table="users", column="amount", precision=-1)

    def test_non_integer_precision_rejected(self):
        with pytest.raises(ValueError):
            PrecisionConstraint(table="users", column="amount", precision="2")  # type: ignore[arg-type]

    def test_get_constraint_info_reports_class_name(self):
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        info = c.get_constraint_info()
        assert info["constraint_type"] == "PrecisionConstraint"
        assert info["table"] == "users"


# ============================================================================
# 2. validate 行为（核心语义 + 边缘）
# ============================================================================


class TestPrecisionValidate:
    def test_valid_decimals_pass(self):
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        datasets = {"users": pd.DataFrame({"amount": [1.23, 0.5, 3.0]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_integers_always_pass(self):
        c = PrecisionConstraint(table="users", column="amount", precision=0)
        datasets = {"users": pd.DataFrame({"amount": [42, 7]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_exceeding_decimals_flagged_with_row_index(self):
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        datasets = {"users": pd.DataFrame({"amount": [1.23, 2.755, 3.0]})}
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "PrecisionViolation"
        assert result["errors"][0]["row_index"] == 1
        assert result["errors"][0]["column"] == "amount"

    def test_precision_zero_flags_any_fraction(self):
        c = PrecisionConstraint(table="users", column="amount", precision=0)
        datasets = {"users": pd.DataFrame({"amount": [1.5, 3]})}
        result = c.validate(datasets)
        assert [e["row_index"] for e in result["errors"]] == [0]

    def test_non_numeric_value_flagged(self):
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        datasets = {"users": pd.DataFrame({"amount": ["1.23", "abc", "2.0"]})}
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "PrecisionViolation"
        assert result["errors"][0]["row_index"] == 1

    def test_multiple_violations_each_reported(self):
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        datasets = {"users": pd.DataFrame({"amount": ["1.234", "1.23", "abc"]})}
        result = c.validate(datasets)
        rows = sorted(e["row_index"] for e in result["errors"])
        assert rows == [0, 2]

    def test_numeric_strings_are_validated_as_numbers(self):
        """可转数值的字符串按数值处理（不因 dtype 而放过）。"""
        c = PrecisionConstraint(table="users", column="amount", precision=2)
        datasets = {"users": pd.DataFrame({"amount": ["1.23", "2.345"]})}
        result = c.validate(datasets)
        assert [e["row_index"] for e in result["errors"]] == [1]

    def test_decimal_values_checked_exactly(self):
        c = PrecisionConstraint(table="users", column="amount", precision=3)
        datasets = {
            "users": pd.DataFrame(
                {"amount": [Decimal("1.23"), Decimal("1.2345"), Decimal("2.000")]}
            )
        }
        result = c.validate(datasets)
        assert [e["row_index"] for e in result["errors"]] == [1]

    def test_none_value_skipped(self):
        c = PrecisionConstraint(table="users", column="amount", precision=1)
        datasets = {"users": pd.DataFrame({"amount": [0.5, None, 0.2]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_nan_value_skipped(self):
        c = PrecisionConstraint(table="users", column="amount", precision=1)
        datasets = {"users": pd.DataFrame({"amount": [0.5, float("nan")]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_table_not_in_datasets_returns_config_error(self):
        c = PrecisionConstraint(table="missing", column="amount", precision=2)
        result = c.validate({"users": pd.DataFrame({"amount": [1.0]})})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_column_not_in_table_returns_config_error(self):
        c = PrecisionConstraint(table="users", column="nope", precision=2)
        result = c.validate({"users": pd.DataFrame({"amount": [1.0]})})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"


# ============================================================================
# 3. 类型注册表（类型名 → 类）+ 别名 + 支持列表
# ============================================================================


class TestPrecisionRegistry:
    def test_in_constraint_registry(self):
        assert "Precision" in CONSTRAINT_REGISTRY

    def test_resolve_constraint_class_returns_precision(self):
        cls = resolve_constraint_class("Precision")
        assert cls is PrecisionConstraint

    def test_in_supported_types_with_description(self):
        supported = get_supported_constraint_types()
        assert "Precision" in supported
        assert isinstance(supported["Precision"], str)
        assert len(supported["Precision"]) > 0

    def test_normalize_alias(self):
        assert normalize_constraint_type("precision") == "Precision"
        assert normalize_constraint_type("Precision") == "Precision"


# ============================================================================
# 4. 兼容导出层（shim）：名字绑定必须有；__all__ 不得加（既有测试锁定 13 项）
# ============================================================================


class TestPrecisionCompatExports:
    def test_name_bound_in_validation_constraints_shim(self):
        """主注册表路径指向兼容层模块，名字必须绑定在其命名空间（不依赖 __all__）。"""
        assert hasattr(vc, "PrecisionConstraint")
        assert vc.PrecisionConstraint is PrecisionConstraint

    def test_not_added_to_shim_dunder_all(self):
        """兼容层 __all__ 被既有测试硬编码锁定（固定 13 项集合），不得加入新名字。"""
        assert "PrecisionConstraint" not in vc.__all__

    def test_domain_package_exports_precision(self):
        """domain 包本身应正常导出新类（含 __all__）。"""
        assert "PrecisionConstraint" in domain_constraints.__all__
        assert domain_constraints.PrecisionConstraint is PrecisionConstraint


# ============================================================================
# 5. 构建器注册表 + 配置模型枚举 + 端到端工厂构建
# ============================================================================


class TestPrecisionBuildFromConfig:
    def test_constraint_file_accepts_precision_type(self):
        """配置数据模型的 type 枚举必须包含 'Precision'，否则 ConstraintFile 构造失败。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Precision",
            enabled=True,
            refs={"table_id": "users", "column_id": "amount"},
            params={"precision": 3},
        )
        assert cf.type == "Precision"

    def test_factory_builds_precision_constraint(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Precision",
            enabled=True,
            refs={"table_id": "users", "column_id": "amount"},
            params={"precision": 3},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None, f"工厂构建失败: {error}"
        assert isinstance(result, PrecisionConstraint)
        assert result.table == "users"
        assert result.column == "amount"
        assert result.precision == 3

    def test_factory_built_constraint_validates_end_to_end(self):
        """工厂产物应可直接用于校验：能正确报违规。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Precision",
            enabled=True,
            refs={"table_id": "users", "column_id": "amount"},
            params={"precision": 2},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None and result is not None
        datasets = {"users": pd.DataFrame({"amount": ["1.23", "1.234", "abc"]})}
        out = result.validate(datasets)
        assert [e["row_index"] for e in out["errors"]] == [1, 2]
