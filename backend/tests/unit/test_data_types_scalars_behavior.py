"""
@fileoverview 标量数据类型行为测试
"""

from __future__ import annotations

from datetime import date

import pandas as pd
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

    def test_column_with_nulls_does_not_false_positive(self):
        """回归 #2: 含空值的整数列被 pandas 推断为 float64,不应整列误报类型错误。

        真实数据中整数列带空单元格是常态(ID/数量/计数),pandas 会把列推断成 float64,
        str(1.0)="1.0" 原实现不匹配整数正则 → 每个非空值都报 TypeValidationError,
        真实数据错误被假阳性淹没。本测试要求:非空整数值全部解析正确、零类型错误。
        """
        # 含 None → pandas 推断 float64:[1.0, 2.0, nan, 4.0]
        series = pd.Series([1, 2, None, 4])
        parsed, errors = IntegerType().process_column(series, "count", nullable=True)

        # 非空值应全部解析为整数,无类型错误
        assert errors == [], f"不应有类型错误,实际: {errors}"
        assert list(parsed.dropna()) == [1, 2, 4]
        assert parsed.isna().iloc[2], "空值位置应保持 None"

    def test_column_with_nulls_not_nullable_reports_only_null_rows(self):
        """回归 #2: nullable=False 时,含空值的整数列只应对空行报 NotNullViolation,
        不应把非空整数值误报为类型错误(级联引发下游假阳性)。
        """
        series = pd.Series([1, 2, None, 4])
        _, errors = IntegerType().process_column(series, "count", nullable=False)

        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        null_errors = [e for e in errors if e["error_type"] == "NotNullViolation"]
        assert type_errors == [], f"非空整数不应报类型错误,实际: {type_errors}"
        assert len(null_errors) == 1, "只有空行应报 NotNullViolation"
        assert null_errors[0]["row_index"] == 2

    def test_negative_integers_with_nulls(self):
        """回归 #2: 含空值的负数整数列不应误报(负号 + float64 双重风险)。"""
        series = pd.Series([-1, -2, None, 0])
        parsed, errors = IntegerType().process_column(series, "delta", nullable=True)
        assert errors == [], f"负数整数列不应报错,实际: {errors}"
        assert list(parsed.dropna()) == [-1, -2, 0]


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

    def test_column_with_nulls_does_not_false_positive(self):
        """回归 #3: 0/1 布尔列带空值 → float64 → "1.0"/"0.0" 不在合法集合 → 整列误报。
        本测试要求:0/1 列即使有空值,非空值也应正确解析,零类型错误。
        """
        # [1, 0, None, 1] → pandas float64:[1.0, 0.0, nan, 1.0]
        series = pd.Series([1, 0, None, 1])
        parsed, errors = BooleanType().process_column(series, "is_active", nullable=True)

        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert type_errors == [], f"0/1 布尔列不应报类型错误,实际: {type_errors}"
        # 1.0 → True, 0.0 → False
        non_null = parsed.dropna().tolist()
        assert non_null == [True, False, True]
        assert parsed.isna().iloc[2]

    def test_float_one_zero_recognized_as_bool(self):
        """回归 #3: 单元格层面的 float 1.0/0.0 应被识别为有效布尔值。"""
        series = pd.Series([1.0, 0.0], dtype="float64")
        _, errors = BooleanType().process_column(series, "flag", nullable=True)
        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert type_errors == [], f"float 1.0/0.0 应识别为布尔,实际: {type_errors}"


class TestFloatType:
    """FloatType 行为"""

    def test_validates_float_string(self):
        assert FloatType().validate("3.14") == (True, None)

    def test_rejects_invalid(self):
        ok, msg = FloatType().validate("abc")
        assert ok is False
        assert "浮点数" in msg

    @pytest.mark.parametrize("value", ["inf", "-inf", "Infinity", "nan", "NaN"])
    def test_rejects_non_finite(self, value):
        """回归 D10: FloatType 不应接受 inf/-inf/nan。

        原实现 float(value) 对 "inf"/"nan" 返回成功(它们是合法的 Python float),
        导致污染数据(某列混入 "inf")被当合法浮点放行,下游统计(mean/sum)被 inf 污染,
        平均值变 inf、依赖该字段的约束失真。DecimalType 已有 is_finite 检查,FloatType 缺失。
        """
        ok, msg = FloatType().validate(value)
        assert ok is False, f"'{value}' 应被拒(非有限值),实际被接受"
        assert msg is not None

    def test_parse_rejects_non_finite(self):
        """回归 D10: parse 也不应把 'inf' 解析成 inf 浮点数(应抛异常或返回非有限值)。"""
        import math

        for value in ["inf", "nan"]:
            try:
                result = FloatType().parse(value)
            except (ValueError, TypeError):
                # 抛异常是正确的拒绝方式
                continue
            assert not (isinstance(result, float) and (math.isinf(result) or math.isnan(result))), (
                f"parse('{value}') 不应返回 inf/nan,实际: {result}"
            )


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
