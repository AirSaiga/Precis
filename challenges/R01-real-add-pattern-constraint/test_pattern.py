"""R01 — Pattern 约束全链路测试（真实仓库）。

覆盖：类实现、validate 行为、类型注册表、构建器注册表、配置模型枚举、端到端工厂构建。
本文件由 verify.py 复制到 backend/tests/unit/test_r01_pattern.py 运行。
"""

from __future__ import annotations

import pandas as pd

from app.shared.core.project.constraint.factory import create_constraint
from app.shared.core.project.constraint.registry import (
    CONSTRAINT_REGISTRY,
    get_supported_constraint_types,
    normalize_constraint_type,
    resolve_constraint_class,
)
from app.shared.core.project.constraint.types import ConstraintFile
from app.shared.domain.constraints.base import Constraint
from app.shared.domain.constraints.pattern import PatternConstraint
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile


def _make_schema_files() -> dict[str, TableSchemaFile]:
    """构造最小 schema，供工厂构建约束时解析 table_id / column_id。"""
    return {
        "users": TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="email", name="email", type="string"),
                ColumnSpec(id="code", name="code", type="string"),
            ],
        ),
    }


# ============================================================================
# 1. 类实现：继承、构造、属性
# ============================================================================


class TestPatternConstraintClass:
    def test_inherits_constraint(self):
        assert issubclass(PatternConstraint, Constraint)

    def test_constructor_accepts_three_params(self):
        c = PatternConstraint(table="users", column="email", pattern=r"^[a-z]+$")
        assert isinstance(c, Constraint)

    def test_attributes_stored(self):
        c = PatternConstraint(table="users", column="email", pattern=r"^[a-z]+$")
        assert c.table == "users"
        assert c.column == "email"
        assert c.pattern == r"^[a-z]+$"

    def test_get_constraint_info_reports_class_name(self):
        c = PatternConstraint(table="users", column="email", pattern=r"^[a-z]+$")
        info = c.get_constraint_info()
        assert info["constraint_type"] == "PatternConstraint"
        assert info["table"] == "users"


# ============================================================================
# 2. validate 行为
# ============================================================================


class TestPatternValidate:
    def test_valid_values_pass(self):
        c = PatternConstraint(
            table="users", column="email", pattern=r"^[a-z]+@[a-z]+\.[a-z]+$"
        )
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", "c@d.org"]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_non_matching_value_flagged(self):
        c = PatternConstraint(
            table="users", column="email", pattern=r"^[a-z]+@[a-z]+\.[a-z]+$"
        )
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", "not-an-email"]})}
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        # 违规记录应定位到第二行（row_index == 1）
        assert result["errors"][0]["row_index"] == 1
        assert result["errors"][0]["column"] == "email"

    def test_multiple_violations_each_reported(self):
        c = PatternConstraint(
            table="users", column="email", pattern=r"^[a-z]+@[a-z]+\.[a-z]+$"
        )
        datasets = {"users": pd.DataFrame({"email": ["bad1", "a@b.com", "bad2"]})}
        result = c.validate(datasets)
        rows = sorted(e["row_index"] for e in result["errors"])
        assert rows == [0, 2]

    def test_search_semantics_partial_match(self):
        """未锚定的模式应允许部分匹配（re.search 语义）。"""
        c = PatternConstraint(table="users", column="code", pattern=r"\d{3}")
        datasets = {"users": pd.DataFrame({"code": ["abc123def", "xyz", "456"]})}
        result = c.validate(datasets)
        # 仅 "xyz" 不含 3 位连续数字 → 违规
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_none_value_skipped(self):
        c = PatternConstraint(
            table="users", column="email", pattern=r"^[a-z]+@[a-z]+\.[a-z]+$"
        )
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", None]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_nan_value_skipped(self):
        c = PatternConstraint(
            table="users", column="email", pattern=r"^[a-z]+@[a-z]+\.[a-z]+$"
        )
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", float("nan")]})}
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_table_not_in_datasets_returns_config_error(self):
        c = PatternConstraint(table="missing", column="email", pattern=r"^[a-z]+$")
        result = c.validate({"users": pd.DataFrame({"email": ["a"]})})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_column_not_in_table_returns_config_error(self):
        c = PatternConstraint(table="users", column="nope", pattern=r"^[a-z]+$")
        result = c.validate({"users": pd.DataFrame({"email": ["a"]})})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"


# ============================================================================
# 3. 类型注册表（类型名 → 类）
# ============================================================================


class TestPatternRegistry:
    def test_in_constraint_registry(self):
        assert "Pattern" in CONSTRAINT_REGISTRY

    def test_resolve_constraint_class_returns_pattern(self):
        cls = resolve_constraint_class("Pattern")
        assert cls is PatternConstraint

    def test_in_supported_types(self):
        assert "Pattern" in get_supported_constraint_types()

    def test_normalize_alias(self):
        # snake_case / 小写别名应能规范化为 "Pattern"
        assert normalize_constraint_type("pattern") == "Pattern"
        assert normalize_constraint_type("Pattern") == "Pattern"


# ============================================================================
# 4. 构建器注册表 + 配置模型枚举 + 端到端工厂构建
# ============================================================================


class TestPatternBuildFromConfig:
    def test_constraint_file_accepts_pattern_type(self):
        """配置数据模型的 type 枚举必须包含 'Pattern'，否则 ConstraintFile 构造失败。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Pattern",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
            params={"pattern": r"^[a-z]+@[a-z]+\.[a-z]+$"},
        )
        assert cf.type == "Pattern"

    def test_factory_builds_pattern_constraint(self):
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Pattern",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
            params={"pattern": r"^[a-z]+@[a-z]+\.[a-z]+$"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None, f"工厂构建失败: {error}"
        assert isinstance(result, PatternConstraint)
        assert result.table == "users"
        assert result.column == "email"
        assert result.pattern == r"^[a-z]+@[a-z]+\.[a-z]+$"

    def test_factory_built_constraint_validates_end_to_end(self):
        """工厂产物应可直接用于校验：能正确报违规。"""
        cf = ConstraintFile(
            version=2,
            id="c1",
            type="Pattern",
            enabled=True,
            refs={"table_id": "users", "column_id": "email"},
            params={"pattern": r"^[a-z]+@[a-z]+\.[a-z]+$"},
        )
        result, error = create_constraint(cf, _make_schema_files())
        assert error is None and result is not None
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", "bad"]})}
        out = result.validate(datasets)
        assert len(out["errors"]) == 1
        assert out["errors"][0]["row_index"] == 1
