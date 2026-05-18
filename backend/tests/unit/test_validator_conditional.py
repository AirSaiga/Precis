"""
@fileoverview 条件校验器单元测试

测试 ConditionalValidator。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.services.validation.validators.conditional import ConditionalValidator


class TestConditionalValidator:
    def test_simple_condition_pass(self):
        df = pd.DataFrame({"status": ["active", "inactive"], "email": ["a@b.com", ""]})
        v = ConditionalValidator()
        result = v.validate(df, "email", if_column="status", if_value="active", then_condition={"operator": "not_null"})
        assert result.is_valid is True

    def test_simple_condition_fail(self):
        df = pd.DataFrame({"status": ["active", "active"], "email": ["a@b.com", ""]})
        v = ConditionalValidator()
        result = v.validate(df, "email", if_column="status", if_value="active", then_condition={"operator": "not_null"})
        assert result.is_valid is False
        assert result.error_count == 1

    def test_missing_then_condition(self):
        df = pd.DataFrame({"a": [1]})
        v = ConditionalValidator()
        result = v.validate(df, "a", if_column="a", if_value=1)
        assert result.is_valid is False
        assert "不完整" in result.error_rows[0]["error_message"]

    def test_missing_if_column_when_no_conditions(self):
        df = pd.DataFrame({"a": [1]})
        v = ConditionalValidator()
        result = v.validate(df, "a", then_condition="not_null")
        assert result.is_valid is False
        assert "不完整" in result.error_rows[0]["error_message"]

    def test_complex_condition_and_pass(self):
        df = pd.DataFrame({"type": ["vip", "normal"], "amount": [1500, 200], "discount": [100, 50]})
        v = ConditionalValidator()
        result = v.validate(
            df,
            "discount",
            if_conditions=[
                {"column": "type", "operator": "eq", "value": "vip"},
                {"column": "amount", "operator": "greater_than", "value": 1000},
            ],
            if_logic="and",
            then_condition={"operator": "greater_than", "value": 0},
        )
        assert result.is_valid is True

    def test_complex_condition_and_fail(self):
        df = pd.DataFrame({"type": ["vip", "vip"], "amount": [1500, 1500], "discount": [100, -10]})
        v = ConditionalValidator()
        result = v.validate(
            df,
            "discount",
            if_conditions=[
                {"column": "type", "operator": "eq", "value": "vip"},
                {"column": "amount", "operator": "greater_than", "value": 1000},
            ],
            if_logic="and",
            then_condition={"operator": "greater_than", "value": 0},
        )
        assert result.is_valid is False
        assert result.error_count == 1
