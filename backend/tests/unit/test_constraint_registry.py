"""
@fileoverview 约束类型注册表单元测试

测试约束注册表的规范化、参数过滤、类型发现功能。

输入示例:
    normalize_constraint_type("unique")
    filter_kwargs_for_class(UniqueConstraint, {"table": "users", "extra": 1})

输出示例:
    "Unique"
    {"table": "users"}
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.project.constraint.registry import (
    CONSTRAINT_REGISTRY,
    filter_kwargs_for_class,
    get_supported_constraint_types,
    normalize_constraint_type,
)
from app.shared.domain.constraints.unique import UniqueConstraint


class TestNormalizeConstraintType:
    def test_standard_name_returns_itself(self):
        assert normalize_constraint_type("Unique") == "Unique"
        assert normalize_constraint_type("NotNull") == "NotNull"

    def test_snake_case_alias(self):
        assert normalize_constraint_type("not_null") == "NotNull"
        assert normalize_constraint_type("foreign_key") == "ForeignKey"
        assert normalize_constraint_type("allowed_values") == "AllowedValues"

    def test_camel_case_alias(self):
        assert normalize_constraint_type("notnull") == "NotNull"
        assert normalize_constraint_type("foreignkey") == "ForeignKey"

    def test_lower_case_standard(self):
        assert normalize_constraint_type("unique") == "Unique"
        assert normalize_constraint_type("range") == "Range"

    def test_unknown_type_returns_input(self):
        assert normalize_constraint_type("unknown_type") == "unknown_type"

    def test_whitespace_trimmed(self):
        assert normalize_constraint_type("  unique  ") == "Unique"


class TestFilterKwargsForClass:
    def test_filters_unknown_params(self):
        kwargs = {"table": "users", "column": "email", "extra": "ignored"}
        result = filter_kwargs_for_class(UniqueConstraint, kwargs)
        assert "table" in result
        assert "column" in result
        assert "extra" not in result

    def test_empty_kwargs(self):
        assert filter_kwargs_for_class(UniqueConstraint, {}) == {}

    def test_all_known_params(self):
        kwargs = {"table": "users", "column": "email"}
        result = filter_kwargs_for_class(UniqueConstraint, kwargs)
        assert result == kwargs


class TestGetSupportedConstraintTypes:
    def test_returns_dict_with_standard_names(self):
        types = get_supported_constraint_types()
        assert isinstance(types, dict)
        assert "Unique" in types
        assert "NotNull" in types
        assert "AllowedValues" in types
        assert "ForeignKey" in types
        assert "Conditional" in types
        assert "Scripted" in types
        assert "Charset" in types
        assert "DateLogic" in types

    def test_descriptions_are_non_empty(self):
        types = get_supported_constraint_types()
        for desc in types.values():
            assert isinstance(desc, str)
            assert len(desc) > 0


class TestConstraintRegistry:
    def test_registry_contains_unique(self):
        assert "Unique" in CONSTRAINT_REGISTRY
        assert CONSTRAINT_REGISTRY["Unique"] is UniqueConstraint

    def test_registry_contains_all_standard_types(self):
        expected = [
            "Unique",
            "NotNull",
            "AllowedValues",
            "ForeignKey",
            "Range",
            "Conditional",
            "Scripted",
            "Charset",
            "DateLogic",
        ]
        for name in expected:
            assert name in CONSTRAINT_REGISTRY, f"{name} not in registry"
