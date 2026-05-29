"""测试 validation_constraints 兼容导出模块"""

from __future__ import annotations

import app.shared.domain.validation_constraints as vc
from app.shared.domain.constraints import (
    AllowedValuesConstraint,
    CharsetConstraint,
    CompositeConstraint,
    ConditionalConstraint,
    Constraint,
    DateLogicConstraint,
    ForeignKeyConstraints,
    NotNullConstraint,
    RangeConstraint,
    ScriptedConstraint,
    UniqueConstraint,
)
from app.shared.domain.constraints.condition_registry import CONDITION_REGISTRY, register_condition


class TestValidationConstraintsExports:
    def test_all_constraint_classes_exported(self):
        assert vc.Constraint is Constraint
        assert vc.NotNullConstraint is NotNullConstraint
        assert vc.UniqueConstraint is UniqueConstraint
        assert vc.ForeignKeyConstraints is ForeignKeyConstraints
        assert vc.AllowedValuesConstraint is AllowedValuesConstraint
        assert vc.RangeConstraint is RangeConstraint
        assert vc.ConditionalConstraint is ConditionalConstraint
        assert vc.ScriptedConstraint is ScriptedConstraint
        assert vc.CharsetConstraint is CharsetConstraint
        assert vc.DateLogicConstraint is DateLogicConstraint
        assert vc.CompositeConstraint is CompositeConstraint

    def test_condition_registry_exported(self):
        assert vc.CONDITION_REGISTRY is CONDITION_REGISTRY
        assert vc.register_condition is register_condition

    def test_all_listed_in_dunder_all(self):
        expected = {
            "AllowedValuesConstraint",
            "CharsetConstraint",
            "CompositeConstraint",
            "CONDITION_REGISTRY",
            "ConditionalConstraint",
            "Constraint",
            "DateLogicConstraint",
            "ForeignKeyConstraints",
            "NotNullConstraint",
            "RangeConstraint",
            "ScriptedConstraint",
            "UniqueConstraint",
            "register_condition",
        }
        assert set(vc.__all__) == expected

    def test_register_condition_decorator(self):
        @vc.register_condition("test_eq")
        def test_eq(a, b):
            return a == b

        assert "test_eq" in vc.CONDITION_REGISTRY
        assert vc.CONDITION_REGISTRY["test_eq"] is test_eq
