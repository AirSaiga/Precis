"""
@fileoverview 标量数据类型单元测试

测试标量类型（IntegerType, StringType, FloatType, BooleanType, DateType, DecimalType）
的 validate() 和 parse() 方法。

输入示例:
    IntegerType().validate(123)
    StringType().validate("hello")

输出示例:
    (True, None) 或 (False, "错误信息")
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.domain.data_types_parts.scalars import (
    BooleanType,
    DateType,
    DecimalType,
    FloatType,
    IntegerType,
    StringType,
)


class TestIntegerType:
    def test_validate_integer_pass(self):
        assert IntegerType().validate(123) == (True, None)

    def test_validate_integer_string_pass(self):
        assert IntegerType().validate("-42") == (True, None)

    def test_validate_float_string_fail(self):
        valid, error = IntegerType().validate("3.14")
        assert valid is False
        assert "不是一个严格格式的整数" in error

    def test_validate_none_fail(self):
        valid, error = IntegerType().validate(None)
        assert valid is False
        assert "不能为空" in error

    def test_parse_integer(self):
        assert IntegerType().parse("100") == 100
        assert IntegerType().parse(-5) == -5


class TestStringType:
    def test_validate_string_pass(self):
        assert StringType().validate("hello") == (True, None)

    def test_validate_none_fail(self):
        valid, error = StringType().validate(None)
        assert valid is False
        assert "不能为空" in error

    def test_parse_string(self):
        assert StringType().parse(123) == "123"
        assert StringType().parse(True) == "True"


class TestFloatType:
    def test_validate_float_pass(self):
        assert FloatType().validate(3.14) == (True, None)

    def test_validate_float_string_pass(self):
        assert FloatType().validate("2.5") == (True, None)

    def test_validate_invalid_fail(self):
        valid, error = FloatType().validate("abc")
        assert valid is False
        assert "不是一个有效的浮点数" in error

    def test_parse_float(self):
        assert FloatType().parse("3.14") == 3.14


class TestBooleanType:
    def test_validate_bool_pass(self):
        assert BooleanType().validate(True) == (True, None)
        assert BooleanType().validate(False) == (True, None)

    def test_validate_true_strings_pass(self):
        for val in ["true", "yes", "on", "1", "是", "t", "y", "TRUE", "Yes"]:
            assert BooleanType().validate(val) == (True, None), f"failed for {val}"

    def test_validate_false_strings_pass(self):
        for val in ["false", "no", "off", "0", "否", "f", "n", "FALSE", "No"]:
            assert BooleanType().validate(val) == (True, None), f"failed for {val}"

    def test_validate_none_fail(self):
        valid, error = BooleanType().validate(None)
        assert valid is False

    def test_validate_invalid_fail(self):
        valid, error = BooleanType().validate("maybe")
        assert valid is False
        assert "不是一个有效的布尔值" in error

    def test_parse_bool(self):
        assert BooleanType().parse(True) is True
        assert BooleanType().parse("yes") is True
        assert BooleanType().parse("no") is False
        assert BooleanType().parse("false") is False


class TestDateType:
    def test_validate_date_pass(self):
        assert DateType().validate("2024-01-15") == (True, None)

    def test_validate_invalid_date_fail(self):
        valid, error = DateType().validate("2024-13-01")
        assert valid is False
        assert "不是有效的日期格式" in error

    def test_validate_none_fail(self):
        valid, error = DateType().validate(None)
        assert valid is False

    def test_parse_date(self):
        from datetime import date

        assert DateType().parse("2024-06-01") == date(2024, 6, 1)


class TestDecimalType:
    def test_validate_decimal_pass(self):
        assert DecimalType().validate("123.45") == (True, None)

    def test_validate_precision_fail(self):
        dt = DecimalType(precision=3)
        valid, error = dt.validate("1234")
        assert valid is False
        assert "超出精度限制" in error

    def test_validate_scale_fail(self):
        dt = DecimalType(scale=1)
        valid, error = dt.validate("1.234")
        assert valid is False
        assert "小数位数超出限制" in error

    def test_validate_invalid_fail(self):
        valid, error = DecimalType().validate("abc")
        assert valid is False
        assert "不是一个有效的数值" in error

    def test_parse_decimal(self):
        from decimal import Decimal

        assert DecimalType().parse("99.99") == Decimal("99.99")
