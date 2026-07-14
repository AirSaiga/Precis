"""允许值约束单元测试"""

import numpy as np
import pandas as pd
import pytest

from app.shared.domain.constraints.allowed_values import AllowedValuesConstraint


class TestAllowedValuesConstraint:
    """AllowedValuesConstraint 单元测试"""

    def test_allowed_values_pass(self):
        """所有值都在允许集合中，验证通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "status": ["active", "inactive", "pending"],
                }
            )
        }
        constraint = AllowedValuesConstraint(
            table="users", column="status", allowed_values={"active", "inactive", "pending"}
        )
        result = constraint.validate(datasets)

        assert result["errors"] == []
        assert result["info"]["constraint_type"] == "AllowedValuesConstraint"

    def test_allowed_values_fail(self):
        """存在值不在允许集合中，验证失败"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3, 4],
                    "status": ["active", "inactive", "pending", "deleted"],
                }
            )
        }
        constraint = AllowedValuesConstraint(
            table="users", column="status", allowed_values={"active", "inactive", "pending"}
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "AllowedValuesViolation"
        assert result["errors"][0]["row_index"] == 3
        assert result["errors"][0]["value"] == "deleted"
        assert "deleted" in result["errors"][0]["message"]

    def test_allowed_values_multiple_failures(self):
        """多个值不在允许集合中，验证失败"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3, 4],
                    "status": ["active", "deleted", "banned", "active"],
                }
            )
        }
        constraint = AllowedValuesConstraint(table="users", column="status", allowed_values={"active", "inactive"})
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 2
        assert result["errors"][0]["value"] == "deleted"
        assert result["errors"][1]["value"] == "banned"

    def test_allowed_values_null_ignored(self):
        """空值（None/NaN）不视为违规"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "status": ["active", None, np.nan],
                }
            )
        }
        constraint = AllowedValuesConstraint(table="users", column="status", allowed_values={"active", "inactive"})
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_table_not_found(self):
        """表不存在时返回配置错误"""
        datasets = {}
        constraint = AllowedValuesConstraint(table="missing", column="status", allowed_values={"active"})
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "missing" in result["errors"][0]["message"]

    def test_column_not_found(self):
        """列不存在时返回配置错误"""
        datasets = {"users": pd.DataFrame({"id": [1, 2, 3]})}
        constraint = AllowedValuesConstraint(table="users", column="status", allowed_values={"active"})
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "status" in result["errors"][0]["message"]

    def test_empty_allowed_values_raises(self):
        """空集合应抛出 ValueError"""
        with pytest.raises(ValueError, match="allowed_values 不能为空集合"):
            AllowedValuesConstraint(table="users", column="status", allowed_values=set())

    def test_empty_table_raises(self):
        """空表名应抛出 ValueError"""
        with pytest.raises(ValueError, match="table 不能为空"):
            AllowedValuesConstraint(table="", column="status", allowed_values={"active"})

    def test_empty_table_whitespace_raises(self):
        """空白表名应抛出 ValueError"""
        with pytest.raises(ValueError, match="table 不能为空"):
            AllowedValuesConstraint(table="   ", column="status", allowed_values={"active"})

    def test_empty_column_raises(self):
        """空列名应抛出 ValueError"""
        with pytest.raises(ValueError, match="column 不能为空"):
            AllowedValuesConstraint(table="users", column="", allowed_values={"active"})

    def test_empty_column_whitespace_raises(self):
        """空白列名应抛出 ValueError"""
        with pytest.raises(ValueError, match="column 不能为空"):
            AllowedValuesConstraint(table="users", column="   ", allowed_values={"active"})

    def test_get_constraint_info(self):
        """约束信息返回正确"""
        constraint = AllowedValuesConstraint(table="users", column="status", allowed_values={"active", "inactive"})
        info = constraint.get_constraint_info()

        assert info["constraint_type"] == "AllowedValuesConstraint"
        assert info["table"] == "users"
        assert "status" in info["description"]
        assert "active" in info["description"]
