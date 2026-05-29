"""测试数值和类型相关 Transform 运行器"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.shared.domain.transforms.cast_type import CastTypeRunner
from app.shared.domain.transforms.digits import DigitsRunner
from app.shared.domain.transforms.fill_na import FillNARunner
from app.shared.domain.transforms.map_value import MapValueRunner
from app.shared.domain.transforms.math_expr import MathExprRunner
from app.shared.domain.transforms.modulo import ModuloRunner
from app.shared.domain.transforms.weighted_sum import WeightedSumRunner


class TestCastTypeRunner:
    def test_cast_to_int(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": ["1", "2", "abc"]})
        result = runner.execute(df, "value", {"target_type": "int"}, ["int_col"])
        assert result["int_col"][0] == 1
        assert result["int_col"][1] == 2
        assert pd.isna(result["int_col"][2])

    def test_cast_to_float(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": ["1.5", "2", "abc"]})
        result = runner.execute(df, "value", {"target_type": "float"}, ["float_col"])
        assert result["float_col"][0] == 1.5
        assert result["float_col"][1] == 2.0
        assert pd.isna(result["float_col"][2])

    def test_cast_to_bool(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": ["yes", "0", "off", "UNKNOWN"]})
        result = runner.execute(df, "value", {"target_type": "bool"}, ["bool_col"])
        assert result["bool_col"][0] is True
        assert result["bool_col"][1] is False
        assert result["bool_col"][2] is False
        assert pd.isna(result["bool_col"][3])

    def test_cast_bool_native_values(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": [True, False, 1, 0]})
        result = runner.execute(df, "value", {"target_type": "bool"}, ["bool_col"])
        assert result["bool_col"][0]
        assert not result["bool_col"][1]
        assert result["bool_col"][2]
        assert not result["bool_col"][3]

    def test_cast_to_datetime(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": ["2023-01-01", "invalid"]})
        result = runner.execute(df, "value", {"target_type": "datetime"}, ["dt_col"])
        assert pd.notna(result["dt_col"][0])
        assert pd.isna(result["dt_col"][1])

    def test_cast_to_string(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": [1, np.nan, "hello"]})
        result = runner.execute(df, "value", {"target_type": "string"}, ["str_col"])
        assert result["str_col"][0] == "1"
        assert pd.isna(result["str_col"][1])
        assert result["str_col"][2] == "hello"

    def test_cast_integer_alias(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": ["42"]})
        result = runner.execute(df, "value", {"target_type": "integer"}, ["int_col"])
        assert result["int_col"][0] == 42

    def test_unsupported_type_raises(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"value": ["1"]})
        with pytest.raises(ValueError, match="不支持的目标类型"):
            runner.execute(df, "value", {"target_type": "decimal"}, ["x"])

    def test_missing_column_raises(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])

    def test_empty_output_raises(self):
        runner = CastTypeRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {}, [])


class TestFillNARunner:
    def test_fill_with_value(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [1, None, 3]})
        result = runner.execute(df, "value", {"strategy": "value", "value": 0}, ["filled"])
        assert result["filled"].tolist() == [1, 0, 3]

    def test_ffill(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [1, None, None, 4]})
        result = runner.execute(df, "value", {"strategy": "ffill"}, ["filled"])
        assert result["filled"].tolist() == [1, 1, 1, 4]

    def test_bfill(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [1, None, None, 4]})
        result = runner.execute(df, "value", {"strategy": "bfill"}, ["filled"])
        assert result["filled"].tolist() == [1, 4, 4, 4]

    def test_mean(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [10.0, 20.0, None]})
        result = runner.execute(df, "value", {"strategy": "mean"}, ["filled"])
        assert result["filled"][2] == 15.0

    def test_median(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [10.0, 20.0, 30.0, None]})
        result = runner.execute(df, "value", {"strategy": "median"}, ["filled"])
        assert result["filled"][3] == 20.0

    def test_mean_all_nan(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [None, None]})
        result = runner.execute(df, "value", {"strategy": "mean"}, ["filled"])
        assert pd.isna(result["filled"][0])

    def test_unsupported_strategy_raises(self):
        runner = FillNARunner()
        df = pd.DataFrame({"value": [1]})
        with pytest.raises(ValueError, match="不支持的 FillNA 策略"):
            runner.execute(df, "value", {"strategy": "mode"}, ["x"])

    def test_missing_column_raises(self):
        runner = FillNARunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])


class TestMathExprRunner:
    def test_basic_expr(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
        result = runner.execute(df, "a", {"expression": "a + b"}, ["sum"])
        assert result["sum"].tolist() == [4, 6]

    def test_at_column_syntax(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"col_a": [1, 2], "col_b": [3, 4]})
        result = runner.execute(df, "col_a", {"expression": "@col_a + @col_b"}, ["sum"])
        assert result["sum"].tolist() == [4, 6]

    def test_output_type_int(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"a": [1.5, 2.0]})
        result = runner.execute(df, "a", {"expression": "a * 2", "output_type": "int"}, ["out"])
        assert result["out"][0] == 3
        assert result["out"][1] == 4

    def test_output_type_float(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"a": [1, 2]})
        result = runner.execute(df, "a", {"expression": "a / 2", "output_type": "float"}, ["out"])
        assert result["out"][0] == 0.5

    def test_empty_expr_raises(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要 expression 参数"):
            runner.execute(df, "a", {}, ["x"])

    def test_invalid_expr_raises(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="数学表达式计算失败"):
            runner.execute(df, "a", {"expression": "invalid +++"}, ["x"])

    def test_empty_output_raises(self):
        runner = MathExprRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要至少一个 output_columns"):
            runner.execute(df, "a", {"expression": "a + 1"}, [])


class TestModuloRunner:
    def test_basic_modulo(self):
        runner = ModuloRunner()
        df = pd.DataFrame({"value": [10, 15, 20]})
        result = runner.execute(df, "value", {"divisor": 7}, ["mod"])
        assert result["mod"].tolist() == [3, 1, 6]

    def test_divisor_zero_raises(self):
        runner = ModuloRunner()
        df = pd.DataFrame({"value": [1]})
        with pytest.raises(ValueError, match="divisor 不能为 0"):
            runner.execute(df, "value", {"divisor": 0}, ["x"])

    def test_missing_column_raises(self):
        runner = ModuloRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])


class TestWeightedSumRunner:
    def test_basic_weighted_sum(self):
        runner = WeightedSumRunner()
        df = pd.DataFrame({"digits": ["110"]})
        result = runner.execute(df, "digits", {"weights": [7, 9, 10]}, ["sum"])
        assert result["sum"][0] == 1 * 7 + 1 * 9 + 0 * 10

    def test_comma_separated(self):
        runner = WeightedSumRunner()
        df = pd.DataFrame({"digits": ["1,1,0"]})
        result = runner.execute(df, "digits", {"weights": [7, 9, 10]}, ["sum"])
        assert result["sum"][0] == 1 * 7 + 1 * 9 + 0 * 10

    def test_weights_shorter_than_digits(self):
        runner = WeightedSumRunner()
        df = pd.DataFrame({"digits": ["1234"]})
        result = runner.execute(df, "digits", {"weights": [1, 2]}, ["sum"])
        assert result["sum"][0] == 1 * 1 + 2 * 2

    def test_non_numeric_digit_skipped(self):
        runner = WeightedSumRunner()
        df = pd.DataFrame({"digits": ["1a2"]})
        result = runner.execute(df, "digits", {"weights": [1, 1, 1]}, ["sum"])
        assert result["sum"][0] == 1 * 1 + 0 * 1 + 2 * 1

    def test_missing_weights_raises(self):
        runner = WeightedSumRunner()
        df = pd.DataFrame({"a": ["1"]})
        with pytest.raises(ValueError, match="需要 weights 参数"):
            runner.execute(df, "a", {}, ["x"])

    def test_missing_column_raises(self):
        runner = WeightedSumRunner()
        df = pd.DataFrame({"a": ["1"]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {"weights": [1]}, ["x"])


class TestMapValueRunner:
    def test_basic_mapping(self):
        runner = MapValueRunner()
        df = pd.DataFrame({"idx": [0, 1, 2]})
        result = runner.execute(df, "idx", {"mapping": ["a", "b", "c"]}, ["mapped"])
        assert result["mapped"].tolist() == ["a", "b", "c"]

    def test_out_of_bounds_returns_original(self):
        runner = MapValueRunner()
        df = pd.DataFrame({"idx": [5, -1]})
        result = runner.execute(df, "idx", {"mapping": ["a", "b"]}, ["mapped"])
        assert result["mapped"][0] == 5
        assert result["mapped"][1] == -1

    def test_non_numeric_returns_original(self):
        runner = MapValueRunner()
        df = pd.DataFrame({"idx": ["hello"]})
        result = runner.execute(df, "idx", {"mapping": ["a"]}, ["mapped"])
        assert result["mapped"][0] == "hello"

    def test_empty_mapping_raises(self):
        runner = MapValueRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="需要 mapping 参数"):
            runner.execute(df, "a", {}, ["x"])

    def test_missing_column_raises(self):
        runner = MapValueRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {"mapping": ["a"]}, ["x"])


class TestDigitsRunner:
    def test_basic(self):
        runner = DigitsRunner()
        df = pd.DataFrame({"code": ["110101"]})
        result = runner.execute(df, "code", {}, ["digits"])
        assert result["digits"][0] == "1,1,0,1,0,1"

    def test_missing_column_raises(self):
        runner = DigitsRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="输入列不存在"):
            runner.execute(df, "missing", {}, ["x"])
