"""
@fileoverview 约束抽象基类单元测试

测试 Constraint 基类的默认行为。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd
import pytest

from app.shared.domain.constraints.base import Constraint


class DummyConstraint(Constraint):
    def __init__(self, table="users"):
        self.table = table

    def validate(self, datasets, **kwargs):
        return {"valid": True, "errors": []}


class TestConstraintBase:
    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            Constraint()

    def test_get_constraint_info(self):
        c = DummyConstraint(table="orders")
        info = c.get_constraint_info()
        assert info["constraint_type"] == "DummyConstraint"
        assert info["table"] == "orders"
        assert "约束" in info["description"]

    def test_get_constraint_info_uses_from_table_fallback(self):
        class FKConstraint(Constraint):
            def __init__(self):
                self.from_table = "orders"

            def validate(self, datasets, **kwargs):
                return {"valid": True, "errors": []}

        c = FKConstraint()
        info = c.get_constraint_info()
        assert info["table"] == "orders"

    def test_get_constraint_info_no_table(self):
        class NoTableConstraint(Constraint):
            def validate(self, datasets, **kwargs):
                return {"valid": True, "errors": []}

        c = NoTableConstraint()
        info = c.get_constraint_info()
        assert info["table"] is None

    def test_description_format(self):
        c = DummyConstraint()
        assert c._get_description() == "DummyConstraint 约束"

    def test_validate_returns_dict(self):
        datasets = {"users": pd.DataFrame({"id": [1]})}
        c = DummyConstraint()
        result = c.validate(datasets)
        assert isinstance(result, dict)
        assert result["valid"] is True
