"""
@fileoverview 标量数据类型行为测试
"""

from __future__ import annotations

from datetime import date

import pytest

from app.shared.domain.data_types import BooleanType, DateType, FloatType, IntegerType


class TestIntegerType:
    """IntegerType 行为"""

    def test_validates_integer_string(self):
        assert IntegerType().validate("42") == (True, None)

    def test_rejects_non_integer(self):
        ok, msg = IntegerType().validate("not-a-number")
        assert ok is False
        assert "整数" in msg

    def test_rejects_none(self):
        ok, msg = IntegerType().validate(None)
        assert ok is False


class TestFloatType:
    """FloatType 行为"""

    def test_validates_float_string(self):
        assert FloatType().validate("3.14") == (True, None)

    def test_rejects_invalid(self):
        ok, msg = FloatType().validate("abc")
        assert ok is False
        assert "浮点数" in msg


class TestBooleanType:
    """BooleanType 行为"""

    @pytest.mark.parametrize(
        "value",
        [True, "true", "yes", "1", "是"],
    )
    def test_accepts_true_values(self, value):
        assert BooleanType().validate(value)[0] is True

    def test_rejects_none(self):
        assert BooleanType().validate(None)[0] is False


class TestDateType:
    """DateType 行为"""

    def test_validates_date(self):
        assert DateType().validate("2024-01-01") == (True, None)

    def test_rejects_invalid_date(self):
        ok, msg = DateType().validate("not-a-date")
        assert ok is False
        assert "日期" in msg

    def test_rejects_none(self):
        assert DateType().validate(None)[0] is False

    def test_parse_returns_date(self):
        assert DateType().parse("2024-06-15") == date(2024, 6, 15)
