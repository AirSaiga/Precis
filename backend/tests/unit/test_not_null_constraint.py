"""非空约束单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import pandas as pd

from app.shared.domain.constraints.not_null import NotNullConstraint


class TestNotNullConstraint:
    """NotNullConstraint 单元测试"""

    def test_not_null_pass(self):
        """所有值非空时验证通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "username": ["alice", "bob", "charlie"],
                }
            )
        }
        constraint = NotNullConstraint(table="users", column="username")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_not_null_fail_with_none(self):
        """包含 None 值时验证失败"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "username": ["alice", None, "charlie"],
                }
            )
        }
        constraint = NotNullConstraint(table="users", column="username")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "NotNullViolation"
        assert result["errors"][0]["row_index"] == 1

    def test_not_null_fail_with_nan(self):
        """包含 NaN 值时验证失败"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "score": [85.5, float("nan"), 92.0],
                }
            )
        }
        constraint = NotNullConstraint(table="users", column="score")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "NotNullViolation"

    def test_table_not_found(self):
        """表不存在时返回配置错误"""
        datasets = {}
        constraint = NotNullConstraint(table="missing", column="username")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_column_not_found(self):
        """列不存在时返回配置错误"""
        datasets = {"users": pd.DataFrame({"id": [1, 2, 3]})}
        constraint = NotNullConstraint(table="users", column="missing")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_get_constraint_info(self):
        """约束信息返回正确"""
        constraint = NotNullConstraint(table="users", column="username")
        info = constraint.get_constraint_info()

        assert info["constraint_type"] == "NotNullConstraint"
        assert info["table"] == "users"
        assert "username" in info["description"]
