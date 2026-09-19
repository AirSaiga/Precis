# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview 2026-09-18 逻辑漏洞治理第二轮 B2 批次（后端 fail-fast）回归测试

覆盖 docs/plans/2026-09-18-logic-remediation/01 规格中 B2 批次的修复：
- §1.2  Conditional if_value 留空 → 配置错误
- §1.5  比较类阈值不可转数值/缺省 → 配置错误（约束侧 + transforms 侧）
- §1.6  FillNA(mean/median) 只填真空值
- §1.8  regex match_mode 未知值 → 配置错误（大小写归一）
- §1.9  Scripted re_match 对齐 fullmatch
- §1.10 FK 值归一双侧对称去尾随零
- §1.11 AllowedValues 归一处理 Decimal 整数值
- §1.12 date_logic calculation 未知 compare_op → 配置错误
- §1.13 无效日期行报"日期无效"
- §1.23 Conditional _safe_eq 双侧 NaN 豁免
- §1.24 map_value 非整数索引 / weighted_sum 位数不齐报错
- §1.29 reporters null 键/条目跳过
- §1.32 regex 工具 NaN 按空串
- §1.20 Decimal 精度数值语义 / §1.21 带时间 datetime 视为合法 date（在 test_scalars 语义族补充）
"""

from __future__ import annotations

from decimal import Decimal

import pandas as pd
import pytest

# ============================================================
# §1.2 Conditional if_value 留空
# ============================================================


class TestIfValueMissing:
    def _datasets(self):
        return {"t": pd.DataFrame({"status": ["A", "B"], "c": [None, None]})}

    def test_simple_condition_if_value_none_reports_config_error(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_column="status",
            if_value=None,
            then_column="c",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(self._datasets())
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        violations = [e for e in result["errors"] if e["error_type"] == "ConditionalViolation"]
        assert len(config_errors) == 1
        assert "if_value" in config_errors[0]["message"]
        assert violations == []

    def test_composite_eq_without_value_reports_config_error(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "status", "operator": "eq", "value": None}],
            then_column="c",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(self._datasets())
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        assert len(config_errors) == 1
        assert "eq" in config_errors[0]["message"]

    def test_not_null_condition_without_value_not_affected(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        datasets = {"t": pd.DataFrame({"status": ["A", ""], "c": [None, None]})}
        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "status", "operator": "not_null"}],
            then_column="c",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)
        assert all(e["error_type"] != "ConstraintConfigError" for e in result["errors"])
        # 第 1 行 status="A" 非空触发 THEN，c 为空 → 违规恰 1 条
        assert len([e for e in result["errors"] if e["error_type"] == "ConditionalViolation"]) == 1


# ============================================================
# §1.5 阈值不可转数值 / 缺省
# ============================================================


class TestThresholdFailFast:
    def test_if_greater_than_without_value_reports_config_error(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "age", "operator": "greater_than", "value": None}],
            then_column="c",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate({"t": pd.DataFrame({"age": [10, 20], "c": [None, None]})})
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        assert len(config_errors) == 1
        assert "greater_than" in config_errors[0]["message"]

    def test_if_greater_than_bad_threshold_reports_config_error(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "age", "operator": "greater_than", "value": "abc"}],
            then_column="c",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate({"t": pd.DataFrame({"age": [10], "c": [None]})})
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        assert len(config_errors) == 1
        assert "abc" in config_errors[0]["message"]

    def test_if_greater_than_valid_threshold_triggers(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "age", "operator": "greater_than", "value": 10}],
            then_column="c",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate({"t": pd.DataFrame({"age": [10, 20], "c": ["ok", None]})})
        # 仅 age=20 触发，其 c 为空 → 1 条违规；age=10 不大于 10 不触发
        violations = [e for e in result["errors"] if e["error_type"] == "ConditionalViolation"]
        assert len(violations) == 1

    def test_transform_threshold_unconvertible_raises(self):
        from app.shared.domain.transforms.filter_rows import FilterRowsRunner

        runner = FilterRowsRunner()
        df = pd.DataFrame({"a": [1, 5000]})
        with pytest.raises(ValueError, match="无法转换为数值"):
            runner.execute(df, "a", {"conditions": [{"column": "a", "op": "gt", "value": "1,000"}], "logic": "and"}, [])

    def test_transform_threshold_none_raises(self):
        from app.shared.domain.transforms.conditional_assign import ConditionalAssignRunner

        runner = ConditionalAssignRunner()
        df = pd.DataFrame({"a": [1]})
        with pytest.raises(ValueError, match="阈值未配置"):
            runner.execute(
                df, "a", {"conditions": [{"column": "a", "op": "gte", "value": None}], "then_value": "x"}, ["out"]
            )


# ============================================================
# §1.6 FillNA mean/median 只填真空值
# ============================================================


class TestFillNAPreservesNonNumeric:
    def test_mean_keeps_non_numeric_values(self):
        from app.shared.domain.transforms.fill_na import FillNARunner

        runner = FillNARunner()
        df = pd.DataFrame({"v": [1, "abc", None, 3]})
        result = runner.execute(df, "v", {"strategy": "mean"}, ["out"])
        assert result["out"].tolist()[0] == 1
        assert result["out"].tolist()[1] == "abc"  # 非空非数值保留原样
        assert result["out"].tolist()[2] == 2.0  # 空位填均值 (1+3)/2
        assert result["out"].tolist()[3] == 3

    def test_median_keeps_non_numeric_values(self):
        from app.shared.domain.transforms.fill_na import FillNARunner

        runner = FillNARunner()
        df = pd.DataFrame({"v": ["xyz", None, 1, 3]})
        result = runner.execute(df, "v", {"strategy": "median"}, ["out"])
        assert result["out"].tolist()[0] == "xyz"
        assert result["out"].tolist()[1] == 2.0  # 中位数 (1+3)/2

    def test_all_null_column_stays_null(self):
        from app.shared.domain.transforms.fill_na import FillNARunner

        runner = FillNARunner()
        df = pd.DataFrame({"v": [None, None]})
        result = runner.execute(df, "v", {"strategy": "mean"}, ["out"])
        assert result["out"].isna().all()  # 全空列均值为 NaN，保持空


# ============================================================
# §1.8 regex match_mode 未知值
# ============================================================


class TestRegexMatchMode:
    def _constraint(self, match_mode):
        from app.shared.domain.constraints.regex import RegexConstraint

        return RegexConstraint(
            table="t", column="c", pattern=r"\d+", match_mode=match_mode, case_sensitive=True, flags=""
        )

    def test_uppercase_full_is_valid(self):
        result = self._constraint("Full").validate({"t": pd.DataFrame({"c": ["123", "abc"]})})
        violations = [e for e in result["errors"] if e["error_type"] == "RegexViolation"]
        assert len(violations) == 1  # "abc" 违规（fullmatch 语义）

    def test_unknown_match_mode_reports_config_error(self):
        for bad in ("fullmatch", "partial"):
            result = self._constraint(bad).validate({"t": pd.DataFrame({"c": ["123"]})})
            config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
            assert len(config_errors) == 1, bad
            assert "match_mode" in config_errors[0]["message"]
            assert all(e["error_type"] != "RegexViolation" for e in result["errors"])

    def test_default_match_mode_is_full(self):
        """缺省（None）→ full（向后兼容现状默认）"""
        result = self._constraint(None).validate({"t": pd.DataFrame({"c": ["123abc"]})})
        # full 语义下 "123abc" 不整体匹配 \d+ → 违规
        assert len([e for e in result["errors"] if e["error_type"] == "RegexViolation"]) == 1


# ============================================================
# §1.9 Scripted re_match fullmatch 语义
# ============================================================


class TestScriptedReMatchFullmatch:
    def _run(self, expression, values):
        from app.shared.domain.constraints.scripted import ScriptedConstraint

        constraint = ScriptedConstraint(table="t", column="c", name="s", expression=expression)
        return constraint.validate({"t": pd.DataFrame({"c": values})}, allow_unsafe_eval=True)

    def test_trailing_newline_no_longer_matches(self):
        result = self._run('re_match("^\\d+$", str(value)) == True', ["123\n"])
        # 原实现 re.match 的 $ 容忍尾随换行会通过；fullmatch 严格 → 违规
        violations = [e for e in result["errors"] if e["error_type"] == "BusinessLogicViolation"]
        assert len(violations) == 1

    def test_prefix_match_no_longer_passes(self):
        result = self._run('re_match("\\d+", str(value)) == True', ["abc123"])
        violations = [e for e in result["errors"] if e["error_type"] == "BusinessLogicViolation"]
        assert len(violations) == 1

    def test_exact_match_still_passes(self):
        result = self._run('re_match("^\\d+$", str(value)) == True', ["123"])
        assert result["errors"] == []


# ============================================================
# §1.10 FK 归一双侧对称
# ============================================================


class TestFkNormalizationSymmetry:
    def _validate_fk(self, parent_values, child_values):
        from app.shared.domain.constraints.foreign_key import ForeignKeyConstraints

        constraint = ForeignKeyConstraints(from_table="child", from_column="k", to_table="parent", to_column="id")
        datasets = {
            "parent": pd.DataFrame({"id": parent_values}),
            "child": pd.DataFrame({"k": child_values}),
        }
        return constraint.validate(datasets)

    def test_parent_float_vs_child_string_trailing_zero(self):
        """父 float 123.10 vs 子 str '123.10' → 同键无违规（原实现误报）"""
        result = self._validate_fk([123.10], ["123.10"])
        violations = [e for e in result["errors"] if e["error_type"] == "ForeignKeyViolation"]
        assert violations == []

    def test_parent_string_trailing_zeros_vs_child_int(self):
        """父 '123.0' vs 子 123 → 无违规（回归保旧）"""
        result = self._validate_fk(["123.0"], [123])
        violations = [e for e in result["errors"] if e["error_type"] == "ForeignKeyViolation"]
        assert violations == []

    def test_different_values_still_violate(self):
        result = self._validate_fk([123.10], ["123.2"])
        violations = [e for e in result["errors"] if e["error_type"] == "ForeignKeyViolation"]
        assert len(violations) == 1


# ============================================================
# §1.11 AllowedValues Decimal 整数值
# ============================================================


class TestAllowedValuesDecimal:
    def test_decimal_integral_hits_int_enum(self):
        from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint

        constraint = AllowedValuesConstraint(table="t", column="c", allowed_values=[1, 2, 3])
        result = constraint.validate({"t": pd.DataFrame({"c": [Decimal("1.0"), Decimal("2.00")]})})
        violations = [e for e in result["errors"] if e["error_type"] == "AllowedValuesViolation"]
        assert violations == []

    def test_decimal_non_integral_still_violates(self):
        from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint

        constraint = AllowedValuesConstraint(table="t", column="c", allowed_values=[1])
        result = constraint.validate({"t": pd.DataFrame({"c": [Decimal("1.5")]})})
        assert len([e for e in result["errors"] if e["error_type"] == "AllowedValuesViolation"]) == 1

    def test_mixed_enum_regress(self):
        from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint

        constraint = AllowedValuesConstraint(table="t", column="c", allowed_values=[1, "a", 2.0])
        result = constraint.validate({"t": pd.DataFrame({"c": [1, 1.0, "a", "1", "b"]})})
        # 1/1.0/"a"/"1" 命中；"b" 违规
        assert len([e for e in result["errors"] if e["error_type"] == "AllowedValuesViolation"]) == 1


# ============================================================
# §1.12 date_logic calculation 未知 compare_op
# ============================================================


class TestDateLogicUnknownCompareOp:
    def _constraint(self, calc, compare_op, target_value=None, target_column=None):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        return DateLogicConstraint(
            table="t",
            column="d",
            logic_mode="calculation",
            calculation_type=calc,
            compare_op=compare_op,
            target_value=target_value,
            target_column=target_column,
        )

    def test_age_unknown_op_reports_config_error(self):
        constraint = self._constraint("age", ">", target_value=60)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2000-01-01"]})})
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        assert len(config_errors) == 1
        assert "不支持的比较操作符" in config_errors[0]["message"]
        assert ">" in config_errors[0]["message"]

    def test_days_diff_unknown_op_reports_config_error(self):
        constraint = self._constraint("days_diff", "gte_", target_value=3, target_column="ref")
        result = constraint.validate({"t": pd.DataFrame({"d": ["2024-01-01"], "ref": ["2023-12-29"]})})
        config_errors = [e for e in result["errors"] if e["error_type"] == "ConstraintConfigError"]
        assert len(config_errors) == 1

    def test_compare_op_none_keeps_historical_default(self):
        """缺省 compare_op → age 按 gte / days_diff 按 eq（历史默认保持）"""
        constraint = self._constraint("age", None, target_value=200)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2000-01-01"]})})
        assert all(e["error_type"] != "ConstraintConfigError" for e in result["errors"])

    def test_uppercase_op_normalized(self):
        constraint = self._constraint("age", "GTE", target_value=0)
        result = constraint.validate({"t": pd.DataFrame({"d": ["2000-01-01"]})})
        assert all(e["error_type"] != "ConstraintConfigError" for e in result["errors"])


# ============================================================
# §1.13 无效日期行报"日期无效"
# ============================================================


class TestDateLogicInvalidDates:
    def test_compare_target_column_invalid_date_reported(self):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        constraint = DateLogicConstraint(
            table="t", column="d", logic_mode="compare", compare_op="gte", reference_column="ref"
        )
        result = constraint.validate(
            {"t": pd.DataFrame({"d": ["2024-01-01", "2024-01-02"], "ref": ["2024-13-45", "2024-01-01"]})}
        )
        invalid = [e for e in result["errors"] if e["error_type"] == "DateLogicError" and "日期无效" in e["message"]]
        assert len(invalid) == 1
        assert "2024-13-45" in invalid[0]["message"]
        assert invalid[0]["column"] == "ref"

    def test_target_column_invalid_date_reported_in_calculation(self):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        constraint = DateLogicConstraint(
            table="t",
            column="d",
            logic_mode="calculation",
            calculation_type="days_diff",
            compare_op="eq",
            target_value=3,
            target_column="ref",
        )
        result = constraint.validate(
            {"t": pd.DataFrame({"d": ["not_a_date", "2024-01-05"], "ref": ["2024-01-01", "2024-01-02"]})}
        )
        invalid = [e for e in result["errors"] if "日期无效" in e["message"]]
        assert len(invalid) == 1
        assert "not_a_date" in invalid[0]["message"]

    def test_true_null_values_still_exempt(self):
        from app.shared.domain.constraints.date_logic import DateLogicConstraint

        constraint = DateLogicConstraint(
            table="t", column="d", logic_mode="compare", compare_op="gte", reference_column="ref"
        )
        result = constraint.validate({"t": pd.DataFrame({"d": [None, "2024-01-01"], "ref": [None, "2024-01-01"]})})
        assert result["errors"] == []  # 真空值豁免


# ============================================================
# §1.23 _safe_eq 双侧 NaN
# ============================================================


class TestSafeEqNanExemption:
    def test_then_ref_column_both_nan_no_violation(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_column="status",
            if_value="A",
            then_column="c",
            then_condition={"operator": "eq", "ref_column": "a"},
        )
        datasets = {"t": pd.DataFrame({"status": ["A", "A"], "c": [None, "y"], "a": [None, 5]})}
        result = constraint.validate(datasets)
        violations = [e for e in result["errors"] if e["error_type"] == "ConditionalViolation"]
        # 第 1 行双侧皆 NaN → 豁免；第 2 行 c="y" != a=5 → 违规
        assert len(violations) == 1

    def test_side_nan_expected_value_still_violates(self):
        from app.shared.domain.constraints.conditional import ConditionalConstraint

        constraint = ConditionalConstraint(
            table="t",
            if_column="status",
            if_value="A",
            then_column="c",
            then_condition={"operator": "eq", "value": 5},
        )
        result = constraint.validate({"t": pd.DataFrame({"status": ["A"], "c": [None]})})
        assert len([e for e in result["errors"] if e["error_type"] == "ConditionalViolation"]) == 1


# ============================================================
# §1.24 map_value 非整数索引 / weighted_sum 位数
# ============================================================


class TestMapValueWeightedSum:
    def test_map_value_fractional_index_raises(self):
        from app.shared.domain.transforms.map_value import MapValueRunner

        runner = MapValueRunner()
        df = pd.DataFrame({"idx": [1.9]})
        with pytest.raises(ValueError, match="不是整数，无法查表"):
            runner.execute(df, "idx", {"mapping": ["a", "b", "c"]}, ["out"])

    def test_map_value_integer_index_maps(self):
        from app.shared.domain.transforms.map_value import MapValueRunner

        runner = MapValueRunner()
        df = pd.DataFrame({"idx": [2]})
        result = runner.execute(df, "idx", {"mapping": ["a", "b", "c"]}, ["out"])
        assert result["out"][0] == "c"

    def test_weighted_sum_insufficient_digits_raises(self):
        from app.shared.domain.transforms.weighted_sum import WeightedSumRunner

        runner = WeightedSumRunner()
        df = pd.DataFrame({"digits": ["12"]})
        with pytest.raises(ValueError, match=r"输入位数\(2\)不足权重位数\(3\)"):
            runner.execute(df, "digits", {"weights": [1, 2, 3]}, ["sum"])

    def test_weighted_sum_exact_digits_regression(self):
        from app.shared.domain.transforms.weighted_sum import WeightedSumRunner

        runner = WeightedSumRunner()
        df = pd.DataFrame({"digits": ["123"]})
        result = runner.execute(df, "digits", {"weights": [1, 2, 3]}, ["sum"])
        assert result["sum"][0] == 1 * 1 + 2 * 2 + 3 * 3


# ============================================================
# §1.29 reporters null 容错
# ============================================================


class TestReporterNullTolerance:
    def _make_service(self, tmp_path, config_text: str):
        from app.shared.core.reporter.reporter import ReportService

        (tmp_path / "reporting_config.yaml").write_text(config_text, encoding="utf-8")
        return ReportService(str(tmp_path))

    def test_reporters_null_initializes_with_zero_active(self, tmp_path):
        """§1.29: `reporters:` 键值为 null 时不再 AttributeError 崩溃"""
        service = self._make_service(tmp_path, "reporters:\n")
        assert len(service._active_reporters) == 0

    def test_null_entry_skipped_and_others_processed(self, tmp_path):
        """§1.29: 单条目为 null 跳过；同文件其余条目正常走完激活流程"""
        service = self._make_service(tmp_path, "reporters:\n  empty:\n  local_file:\n    enabled: false\n")
        assert len(service._active_reporters) == 0  # 唯一非空条目未启用

    def test_missing_reporters_key_unchanged(self, tmp_path):
        service = self._make_service(tmp_path, "{}\n")
        assert len(service._active_reporters) == 0


# ============================================================
# §1.32 regex 工具 NaN 按空串
# ============================================================


class TestRegexExtractNanAsEmpty:
    def test_nan_values_do_not_count_as_matches(self):
        from app.shared.core.utils.regex_extract import extract_columns_from_values

        nan = float("nan")
        extracted, groups, match_count, error_count = extract_columns_from_values(
            r"n/a|an", "", True, [nan, "an", None], match_mode="search"
        )
        # NaN 按空串：search "n/a|an" 不命中空串 → 不计入 match；"an" 命中
        assert match_count == 1
        assert error_count == 2

    def test_none_regression(self):
        from app.shared.core.utils.regex_extract import extract_columns_from_values

        extracted, groups, match_count, error_count = extract_columns_from_values(
            r"\d+", "", True, [None, "1"], match_mode="full"
        )
        assert match_count == 1


# ============================================================
# §1.20 / §1.21 scalars 语义族
# ============================================================


class TestScalarsSemantics:
    def test_decimal_precision_representation_insensitive(self):
        """核心不变量：同值（"150"/"1.5E+2"/"150.00"）在任何 precision 下判定完全一致。

        normalize 语义下 150 的有效位数为 2（1.5E+2）：p=2 全过、p=1 全报。
        规格示例断言（"p=3 全报"）与其修复方向（normalize 去尾随零）内部矛盾，
        以拍板核心"同值同精度"为准（偏差已记入规格小节）。
        """
        from app.shared.domain.data_types_parts.scalars import DecimalType

        for precision, expect_ok in ((2, True), (1, False)):
            dtype = DecimalType(precision=precision, scale=2)
            results = [dtype.validate(v)[0] for v in ("150", "1.5E+2", "150.00")]
            assert all(r == expect_ok for r in results), f"precision={precision}: {results}"

    def test_decimal_zero_precision_is_one(self):
        from app.shared.domain.data_types_parts.scalars import DecimalType

        dtype = DecimalType(precision=1)
        assert dtype.validate("0")[0]
        assert dtype.validate("0.00")[0]

    def test_date_type_accepts_datetime_with_time(self):
        from app.shared.domain.data_types_parts.scalars import DateType

        dtype = DateType()
        ok, err = dtype.validate("2024-01-15 08:30:00")
        assert ok, err
        ok, _ = dtype.validate("2024-13-45")
        assert not ok

    def test_date_type_column_with_mixed_datetime(self):
        import datetime as dt

        from app.shared.domain.data_types_parts.scalars import DateType

        dtype = DateType()
        series = pd.Series(["2024-01-15", "2024-01-15 08:30:00", None])
        parsed, errors = dtype.process_column(series, "d", nullable=True)
        assert errors == []
        assert parsed[0] == dt.date(2024, 1, 15)
        assert parsed[1] == dt.date(2024, 1, 15)  # 取日期部分
        assert parsed[2] is None

    def test_date_type_column_invalid_still_errors(self):
        from app.shared.domain.data_types_parts.scalars import DateType

        dtype = DateType()
        series = pd.Series(["2024-13-45"])
        _, errors = dtype.process_column(series, "d", nullable=True)
        assert len(errors) == 1
        assert errors[0]["error_type"] == "TypeValidationError"
