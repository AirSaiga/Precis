"""脚本约束单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import pandas as pd

from app.shared.domain.constraints.scripted import ScriptedConstraint


class TestScriptedConstraint:
    """ScriptedConstraint 单元测试"""

    def _make_datasets(self):
        return {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "phone": ["13800138000", "12345", "13900139000"],
                    "age": [25, 17, 35],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "discount": [10, 60, 30],
                    "total_amount": [100, 100, 100],
                }
            ),
        }

    def test_regex_phone_validation_pass(self):
        """正则表达式验证手机号通过"""
        constraint = ScriptedConstraint(
            table="users",
            name="valid_phone",
            expression='re_match(r"^1[3-9]\\d{9}$", str(value))',
            column="phone",
        )
        result = constraint.validate(self._make_datasets(), allow_unsafe_eval=True)
        # 第1行 phone=12345 不匹配
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_math_comparison_pass(self):
        """数学比较验证通过"""
        constraint = ScriptedConstraint(
            table="orders",
            name="valid_discount",
            expression='value <= row["total_amount"] * 0.5',
            column="discount",
        )
        result = constraint.validate(self._make_datasets(), allow_unsafe_eval=True)
        # 第2行 discount=60 > 50
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_boolean_expression_pass(self):
        """布尔表达式验证通过"""
        constraint = ScriptedConstraint(
            table="users",
            name="adult_check",
            expression="value >= 18",
            column="age",
        )
        result = constraint.validate(self._make_datasets(), allow_unsafe_eval=True)
        # 第2行 age=17 < 18
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_non_boolean_result(self):
        """表达式返回非布尔值时记录错误"""
        constraint = ScriptedConstraint(
            table="users",
            name="bad_expr",
            expression="value + 1",
            column="age",
        )
        result = constraint.validate(self._make_datasets(), allow_unsafe_eval=True)
        assert len(result["errors"]) == 3
        assert result["errors"][0]["error_type"] == "ScriptCheckDefinitionError"

    def test_disabled_by_default(self):
        """默认禁用脚本约束"""
        constraint = ScriptedConstraint(
            table="users",
            name="any",
            expression="True",
        )
        result = constraint.validate(self._make_datasets())
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "PermissionError"

    def test_table_not_found(self):
        """表不存在时返回配置错误"""
        constraint = ScriptedConstraint(
            table="missing",
            name="any",
            expression="True",
        )
        result = constraint.validate({}, allow_unsafe_eval=True)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_len_function(self):
        """len 函数可用"""
        constraint = ScriptedConstraint(
            table="users",
            name="phone_length",
            expression="len(str(value)) == 11",
            column="phone",
        )
        result = constraint.validate(self._make_datasets(), allow_unsafe_eval=True)
        # 第2行 phone=12345 长度不为 11
        assert len(result["errors"]) == 1

    def test_get_constraint_info(self):
        """约束信息返回正确"""
        constraint = ScriptedConstraint(table="users", name="valid_phone", expression="True", column="phone")
        info = constraint.get_constraint_info()
        assert info["constraint_type"] == "ScriptedConstraint"
        assert info["table"] == "users"
