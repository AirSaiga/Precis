"""
@fileoverview date_logic.py 边缘分支单元测试

覆盖 DateLogicConstraint age target_value 转换失败、
DateLogicValidator days_diff target_value int 转换失败分支。
"""

import pandas as pd

from app.shared.domain.constraints.date_logic import DateLogicConstraint
from app.shared.services.validation.validators.date_logic import DateLogicValidator


class TestDateLogicConstraintEdgeCases:
    def test_age_invalid_target_value(self):
        """age 计算时 target_value 无法转换为 float"""
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="calculation",
            calculation_type="age",
            target_value="not_a_number",
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert "target_value 转换失败" in result["errors"][0]["message"]

    def test_unknown_logic_mode_reports_config_error(self):
        """回归: 未识别的 logic_mode 必须报 ConstraintConfigError，不得静默零错误通过。

        原实现 compare/calculation 都不匹配时 fail-open，拼错模式名（如 "comapre"）
        让约束形同虚设且无任何提示。
        """
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="comapre",
            compare_op="gt",
            reference_date="1900-01-01",
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "logic_mode" in result["errors"][0]["message"]

    def test_unknown_calculation_type_reports_config_error(self):
        """回归: 未识别的 calculation_type 必须报 ConstraintConfigError，不得静默通过。"""
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="calculation",
            calculation_type="ages",  # 拼错，合法值是 age/days_diff
            target_value=18,
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "calculation_type" in result["errors"][0]["message"]

    def test_age_without_target_value_reports_config_error(self):
        """回归: calculation_type=age 缺少 target_value 必须报配置错误。

        原实现静默零错误通过，用户漏配目标值时误以为年龄约束已生效。
        """
        c = DateLogicConstraint(
            table="users",
            column="birth_date",
            logic_mode="calculation",
            calculation_type="age",
        )
        df = pd.DataFrame({"birth_date": ["2000-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "target_value" in result["errors"][0]["message"]

    def test_days_diff_without_target_value_reports_config_error(self):
        """回归: calculation_type=days_diff 缺少 target_value 必须报配置错误。"""
        c = DateLogicConstraint(
            table="users",
            column="end_date",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_column="start_date",
        )
        df = pd.DataFrame({"end_date": ["2020-01-10"], "start_date": ["2020-01-01"]})
        result = c.validate({"users": df})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "target_value" in result["errors"][0]["message"]


class TestDateLogicValidatorEdgeCases:
    def test_days_diff_invalid_target_value_int_conversion(self):
        """days_diff 时 target_value 无法转换为 int（且能通过日期解析）"""
        v = DateLogicValidator()
        df = pd.DataFrame({"d": ["2020-01-01"], "target": ["2020-01-10"]})
        result = v.validate(
            df,
            "d",
            logic_mode="calculation",
            calculation_type="days_diff",
            target_value="2020-01-10",
            target_column="target",
        )
        assert result.is_valid is False
        assert len(result.error_rows) == 1
        assert "无效的目标天数值" in result.error_rows[0]["error_message"]
