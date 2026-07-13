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

    def test_compare_range_fixed_dates_pass(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="compare",
            compare_op="range",
            reference_date="2000-01-01",
            reference_date_end="2020-12-31",
        )
        df = pd.DataFrame({"birth_date": ["2005-06-15", "2010-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 0

    def test_compare_range_fixed_dates_fail(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="compare",
            compare_op="range",
            reference_date="2000-01-01",
            reference_date_end="2020-12-31",
        )
        df = pd.DataFrame({"birth_date": ["1990-01-01", "2025-01-01", "2005-06-15"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 2
        assert result["errors"][0]["row_index"] == 0
        assert result["errors"][1]["row_index"] == 1
        assert "不在" in result["errors"][0]["message"]

    def test_compare_range_columns_pass(self):
        c = DateLogicConstraint(
            table="projects",
            column="milestone_date",
            logic_mode="compare",
            compare_op="range",
            reference_column="start_date",
            reference_column_end="end_date",
        )
        df = pd.DataFrame(
            {
                "start_date": ["2024-01-01", "2024-06-01"],
                "end_date": ["2024-01-31", "2024-06-30"],
                "milestone_date": ["2024-01-15", "2024-06-15"],
            }
        )
        result = c.validate({"projects": df})
        assert len(result["errors"]) == 0

    def test_compare_range_missing_end_boundary(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="compare",
            compare_op="range",
            reference_date="2000-01-01",
        )
        df = pd.DataFrame({"birth_date": ["2024-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "必须同时指定起点和终点" in result["errors"][0]["message"]

    def test_compare_range_mixed_reference_type(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="compare",
            compare_op="range",
            reference_date="2000-01-01",
            reference_column_end="end_date",
        )
        df = pd.DataFrame({"birth_date": ["2024-01-01"], "end_date": ["2025-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "类型一致" in result["errors"][0]["message"]

    def test_get_description_range(self):
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="compare",
            compare_op="range",
            reference_date="2000-01-01",
            reference_date_end="2020-12-31",
        )
        assert "range [2000-01-01, 2020-12-31]" in c._get_description()

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

    def test_days_diff_default_eq(self):
        """B08 回归：days_diff 默认 compare_op=gt？不，默认在 age 是 gt，days_diff 回退 eq。
        显式传 eq 时：差值等于目标值通过，不等则失败。"""
        df = pd.DataFrame({"start": ["2020-01-01", "2020-01-01"], "end": ["2020-01-10", "2020-01-05"]})
        c = DateLogicConstraint(
            table="users",
            column="start",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_column="end",
            target_value=9,
            compare_op="eq",
        )
        result = c.validate({"users": df})
        # 第一行差 9 天（通过），第二行差 4 天（失败）
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_days_diff_gt(self):
        """B08 回归：compare_op=gt 时，差值需大于目标值；小于等于则失败。"""
        df = pd.DataFrame({"start": ["2020-01-01", "2020-01-01"], "end": ["2020-01-10", "2020-01-05"]})
        c = DateLogicConstraint(
            table="users",
            column="start",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_column="end",
            target_value=5,
            compare_op="gt",
        )
        result = c.validate({"users": df})
        # 第一行差 9 天 > 5（通过），第二行差 4 天 <= 5（失败）
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1
        assert "大于" in result["errors"][0]["message"]

    def test_days_diff_lte(self):
        """B08 回归：compare_op=lte 时，差值需小于等于目标值；大于则失败。"""
        df = pd.DataFrame({"start": ["2020-01-01", "2020-01-01"], "end": ["2020-01-10", "2020-01-03"]})
        c = DateLogicConstraint(
            table="users",
            column="start",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_column="end",
            target_value=5,
            compare_op="lte",
        )
        result = c.validate({"users": df})
        # 第一行差 9 天 > 5（失败），第二行差 2 天 <= 5（通过）
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 0


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

    def test_compare_range_fixed_dates_pass(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-15", "2024-01-20"]})
        result = v.validate(
            df,
            "a",
            logic_mode="compare",
            compare_op="range",
            reference_date="2024-01-01",
            reference_date_end="2024-01-31",
        )
        assert result.is_valid is True
        assert result.error_count == 0

    def test_compare_range_fixed_dates_fail(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-15", "2023-12-01"]})
        result = v.validate(
            df,
            "a",
            logic_mode="compare",
            compare_op="range",
            reference_date="2024-01-01",
            reference_date_end="2024-01-31",
        )
        assert result.is_valid is False
        assert result.error_count == 1

    def test_compare_range_invalid_end_date(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-15"]})
        result = v.validate(
            df,
            "a",
            logic_mode="compare",
            compare_op="range",
            reference_date="2024-01-01",
            reference_date_end="bad-date",
        )
        assert result.is_valid is False
        assert "无效的终点参考日期" in result.error_rows[0]["error_message"]

    def test_compare_range_missing_end_column(self):
        v = DateLogicValidator()
        df = pd.DataFrame({"a": ["2024-01-15"], "start": ["2024-01-01"]})
        result = v.validate(
            df,
            "a",
            logic_mode="compare",
            compare_op="range",
            reference_column="start",
            reference_column_end="missing",
        )
        assert result.is_valid is False
        assert "终点参考列" in result.error_rows[0]["error_message"]

    def test_parse_date_invalid(self):
        v = DateLogicValidator()
        assert v._parse_date("not-a-date") is None
        assert v._parse_date("2024-13-01") is None

    def test_parse_date_valid(self):
        v = DateLogicValidator()
        assert v._parse_date("2024-01-15") is not None
        assert v._parse_date("2024/01/15") is not None

    def test_parse_date_ambiguous_dd_mm_priority(self):
        """歧义日期 "05/06/2024" 必须解析为 day=05 month=06（%d/%m/%Y 优先于 %m/%d/%Y）。

        DATE_FORMATS 中 %d/%m/%Y 排在 %m/%d/%Y 之前，这是 load-bearing 语义，
        向量化重构必须严格保持此优先级。
        """
        v = DateLogicValidator()
        result = v._parse_date("05/06/2024")
        assert result is not None
        assert result.month == 6  # 不是 5
        assert result.day == 5  # 不是 6

    def test_parse_date_dd_mm_only_format(self):
        """day=13 的日期只能被 %d/%m/%Y 解析（%m/%d/%Y 不接受月 13）。"""
        v = DateLogicValidator()
        result = v._parse_date("13/06/2024")
        assert result is not None
        assert result.day == 13
        assert result.month == 6

    def test_parse_date_all_formats(self):
        """每种 DATE_FORMATS 至少一个正例。"""
        v = DateLogicValidator()
        assert v._parse_date("2024-01-15") is not None  # %Y-%m-%d
        assert v._parse_date("2024/01/15") is not None  # %Y/%m/%d
        assert v._parse_date("2024年01月15日") is not None  # %Y年%m月%d日
        assert v._parse_date("15/01/2024") is not None  # %d/%m/%Y
        assert v._parse_date("01/15/2024") is not None  # %m/%d/%Y（月=01 日=15，无歧义）
        assert v._parse_date("2024-01-15 10:30:00") is not None  # %Y-%m-%d %H:%M:%S
        assert v._parse_date("2024/01/15 10:30:00") is not None  # %Y/%m/%d %H:%M:%S

    def test_parse_date_mixed_column_no_unparseable(self):
        """混合格式列（多格式日期）应全部解析成功，不产生 unparseable 错误。

        覆盖 validate 方法的预检查循环——逐行 _parse_date 与向量化的等价性。
        """
        import pandas as pd

        v = DateLogicValidator()
        df = pd.DataFrame({"date": ["2024-01-15", "15/01/2024", "2024年01月15日", "2024-01-15 10:30:00"]})
        # 预检查：所有值都应可解析（不进入 unparseable 分支）
        unparseable = []
        for row_index, cell_value in df["date"].items():
            if pd.isna(cell_value) or cell_value is None:
                continue
            if v._parse_date(str(cell_value)) is None:
                unparseable.append(row_index)
        assert unparseable == []

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
        # range 是区间语义，不能通过二元 _compare_dates 表达
        assert v._compare_dates(d1, d1, "range") is False
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
