"""
@fileoverview date_logic.py 边缘分支单元测试

覆盖 DateLogicConstraint age target_value 转换失败、
DateLogicValidator days_diff target_value int 转换失败分支。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

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
