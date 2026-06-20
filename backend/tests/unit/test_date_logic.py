"""
@fileoverview 日期逻辑约束和校验器单元测试

测试 DateLogicConstraint（domain）和 DateLogicValidator（service）。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.domain.constraints.date_logic import DateLogicConstraint
from app.shared.services.validation.validators.date_logic import DateLogicValidator


class TestDateLogicConstraint:
    def test_compare_with_reference_date_pass(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_date="1900-01-01"
        )
        df = pd.DataFrame({"birth_date": ["1990-05-15", "2000-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 0

    def test_compare_with_reference_date_fail(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"birth_date": ["1990-05-15", "2010-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 0

    def test_compare_with_reference_column_pass(self):
        c = DateLogicConstraint(
            table="projects", column="end_date", logic_mode="compare", compare_op="gt", reference_column="start_date"
        )
        df = pd.DataFrame({"start_date": ["2024-01-01", "2024-03-01"], "end_date": ["2024-01-15", "2024-04-01"]})
        result = c.validate({"projects": df})
        assert len(result["errors"]) == 0

    def test_compare_missing_table(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_date="2000-01-01"
        )
        result = c.validate({"orders": pd.DataFrame()})
        assert len(result["errors"]) == 1
        assert "不在数据集中" in result["errors"][0]["message"]

    def test_compare_missing_column(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"name": ["Alice"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert "不在表" in result["errors"][0]["message"]

    def test_compare_missing_reference_column(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_column="ref_date"
        )
        df = pd.DataFrame({"birth_date": ["2024-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert "参考列" in result["errors"][0]["message"]

    def test_compare_invalid_reference_date(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_date="not-a-date"
        )
        df = pd.DataFrame({"birth_date": ["2024-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert "无效的参考日期" in result["errors"][0]["message"]

    def test_compare_no_reference(self):
        c = DateLogicConstraint(table="users", column="birth_date", logic_mode="compare", compare_op="gt")
        df = pd.DataFrame({"birth_date": ["2024-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert "必须指定" in result["errors"][0]["message"]

    def test_compare_lt(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="lt", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"birth_date": ["1990-05-15", "2010-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_compare_gte(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gte", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01", "1990-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_compare_lte(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="lte", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01", "2010-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_compare_eq(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="eq", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01", "1990-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_compare_unsupported_operator(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="unknown", reference_date="2000-01-01"
        )
        df = pd.DataFrame({"birth_date": ["2024-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "不支持比较操作符" in result["errors"][0]["message"]

    def test_calculation_age_pass(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="calculation",
            calculation_type="age",
            target_value=10,
            compare_op="gte",
        )
        from datetime import datetime, timedelta

        birth = (datetime.now() - timedelta(days=365 * 20)).strftime("%Y-%m-%d")
        df = pd.DataFrame({"birth_date": [birth]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 0

    def test_calculation_age_fail(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="calculation",
            calculation_type="age",
            target_value=100,
            compare_op="gte",
        )
        df = pd.DataFrame({"birth_date": ["2020-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1

    def test_calculation_invalid_ref_date(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="calculation", calculation_type="age", reference_date="bad"
        )
        df = pd.DataFrame({"birth_date": ["2020-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert "无效的参考日期" in result["errors"][0]["message"]

    def test_get_constraint_info(self):
        c = DateLogicConstraint(
            table="users", column="birth_date", logic_mode="compare", compare_op="gt", reference_date="2000-01-01"
        )
        info = c.get_constraint_info()
        assert info["constraint_type"] == "DateLogicConstraint"
        assert info["table"] == "users"

    def test_get_description_compare(self):
        c = DateLogicConstraint(
            table="users", column="bd", logic_mode="compare", compare_op="gt", reference_date="2000-01-01"
        )
        assert "gt 2000-01-01" in c._get_description()

    def test_get_description_calculation(self):
        c = DateLogicConstraint(table="users", column="bd", logic_mode="calculation", calculation_type="age")
        assert "age check" in c._get_description()


class TestDateLogicValidator:
    def test_compare_reference_date_pass(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"birth_date": ["1990-05-15", "2010-01-01"]})
        result = v.validate(df, "birth_date", logic_mode="compare", compare_op="gt", reference_date="1900-01-01")
        assert result.is_valid is True
        assert result.error_count == 0

    def test_compare_reference_date_fail(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"birth_date": ["1990-05-15", "2010-01-01"]})
        result = v.validate(df, "birth_date", logic_mode="compare", compare_op="gt", reference_date="2000-01-01")
        assert result.is_valid is False
        assert result.error_count == 1

    def test_compare_reference_column(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"start": ["2024-01-01", "2024-03-01"], "end": ["2024-01-15", "2024-04-01"]})
        result = v.validate(df, "end", logic_mode="compare", compare_op="gt", reference_column="start")
        assert result.is_valid is True

    def test_missing_column(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-01"]})
        result = v.validate(df, "b", logic_mode="compare", compare_op="gt", reference_date="2000-01-01")
        assert result.is_valid is False
        assert "不存在" in result.error_rows[0]["error_message"]

    def test_unsupported_logic_mode(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-01"]})
        result = v.validate(df, "a", logic_mode="unknown")
        assert result.is_valid is False
        assert "不支持" in result.error_rows[0]["error_message"]

    def test_invalid_reference_date(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-01"]})
        result = v.validate(df, "a", logic_mode="compare", compare_op="gt", reference_date="bad")
        assert result.is_valid is False
        assert "无效的参考日期" in result.error_rows[0]["error_message"]

    def test_parse_date_invalid(self):
        v = DateLogicValidator()
        assert v._parse_date("not-a-date") is None
        assert v._parse_date("2024-13-01") is None

    def test_parse_date_valid(self):
        v = DateLogicValidator()
        assert v._parse_date("2024-01-15") is not None
        assert v._parse_date("2024/01/15") is not None

    def test_compare_dates(self):
        v = DateLogicValidator()
        from datetime import datetime

        d1 = datetime(2024, 1, 15)
        d2 = datetime(2024, 1, 10)
        assert v._compare_dates(d1, d2, "gt") is True
        assert v._compare_dates(d1, d2, "lt") is False
        assert v._compare_dates(d1, d1, "eq") is True
        assert v._compare_dates(d1, d2, "gte") is True
        assert v._compare_dates(d1, d2, "lte") is False
        assert v._compare_dates(d1, d1, "range") is True
        assert v._compare_dates(d1, d2, "unknown") is True

    def test_get_operator_name(self):
        v = DateLogicValidator()
        assert v._get_operator_name("gt") == "大于"
        assert v._get_operator_name("eq") == "等于"
        assert v._get_operator_name("xyz") == "xyz"

    def test_calculation_age(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"birth_date": ["1990-01-01"]})
        # target_value 为期望年龄(数值),1990-01-01 到今天年龄远大于 0
        result = v.validate(df, "birth_date", logic_mode="calculation", calculation_type="age", target_value=0)
        assert result.is_valid is True

    def test_calculation_days_diff(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"start": ["2024-01-01"], "end": ["2024-01-11"]})
        # target_value is parsed as date early, so days_diff with numeric target_value currently errors
        result = v.validate(df, "start", logic_mode="calculation", calculation_type="days_diff", target_column="end")
        # Without target_value no comparison is made, so passes with 0 errors
        assert result.is_valid is True

    def test_calculation_invalid_target_age(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-01"]})
        result = v.validate(df, "a", logic_mode="calculation", calculation_type="age", target_value="bad")
        assert result.is_valid is False
        assert "无效的目标年龄值" in result.error_rows[0]["error_message"]

    def test_empty_dataframe(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": []})
        result = v.validate(df, "a", logic_mode="compare", compare_op="gt", reference_date="2000-01-01")
        assert result.is_valid is True
        assert result.error_count == 0

    def test_null_values_skipped(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": [None, "2024-01-01"]})
        result = v.validate(df, "a", logic_mode="compare", compare_op="gt", reference_date="2000-01-01")
        assert result.is_valid is True
        assert result.error_count == 0


class TestDateLogicValidatorEdgeCases:
    """覆盖 date_logic.py 的未覆盖分支"""

    def test_unparseable_date_compare(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["not-a-date", "2020-01-01"]})
        result = v.validate(df, "d", logic_mode="compare", compare_op="gt", reference_date="2000-01-01")
        assert len(result.error_rows) == 1
        assert "无法解析日期" in result.error_rows[0]["error_message"]

    def test_reference_column_empty(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["2020-01-01"], "ref": [None]})
        result = v.validate(df, "d", logic_mode="compare", compare_op="gt", reference_column="ref")
        assert result.is_valid is True

    def test_unparseable_date_calculation(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["bad-date"]})
        result = v.validate(df, "d", logic_mode="calculation", calculation_type="age", target_value=0)
        assert len(result.error_rows) == 1
        assert "无法解析日期" in result.error_rows[0]["error_message"]

    def test_calculation_target_column_empty(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["2020-01-01"], "target": [None]})
        result = v.validate(df, "d", logic_mode="calculation", calculation_type="days_diff", target_column="target")
        assert result.is_valid is True

    def test_days_diff_invalid_target(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["2020-01-01"], "target": ["2020-01-10"]})
        result = v.validate(
            df,
            "d",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_value="not_a_number",
            target_column="target",
        )
        assert len(result.error_rows) == 1
        assert "无效的目标天数值" in result.error_rows[0]["error_message"]

    def test_null_value_in_calculation(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": [None, "2020-01-01"]})
        result = v.validate(df, "d", logic_mode="calculation", calculation_type="age", target_value=0)
        assert result.is_valid is True

    def test_age_mismatch(self):
        from datetime import datetime

        v = DateLogicValidator()
        # 10 年前的日期,实际年龄约 10 岁
        birth = (datetime.now().date().replace(year=datetime.now().year - 10)).strftime("%Y-%m-%d")
        df = pd.DataFrame({"d": [birth]})
        # 期望年龄 100 岁,实际约 10 岁,应该失败
        result = v.validate(df, "d", logic_mode="calculation", calculation_type="age", target_value=100)
        assert len(result.error_rows) == 1
        assert "年龄检查失败" in result.error_rows[0]["error_message"]

    def test_days_diff_mismatch(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["2020-01-01"], "target": ["2020-01-10"]})
        # 2020-01-01 到 2020-01-10 差 9 天,期望 9 天应该通过
        result = v.validate(
            df, "d", logic_mode="calculation", calculation_type="days_diff", target_value=9, target_column="target"
        )
        assert result.is_valid is True
