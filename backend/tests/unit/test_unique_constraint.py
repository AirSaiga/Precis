"""唯一性约束单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import pandas as pd
import pytest

from app.shared.domain.constraints.unique import UniqueConstraint


class TestUniqueConstraint:
    """UniqueConstraint 单元测试"""

    def test_single_column_unique_pass(self):
        """单列唯一性验证通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "email": ["a@test.com", "b@test.com", "c@test.com"],
                }
            )
        }
        constraint = UniqueConstraint(table="users", column="email")
        result = constraint.validate(datasets)

        assert result["errors"] == []
        assert result["info"]["constraint_type"] == "UniqueConstraint"

    def test_single_column_unique_fail(self):
        """单列唯一性验证失败"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "email": ["a@test.com", "b@test.com", "a@test.com"],
                }
            )
        }
        constraint = UniqueConstraint(table="users", column="email")
        result = constraint.validate(datasets)

        assert len(result["errors"]) > 0
        assert result["errors"][0]["error_type"] == "UniqueViolation"
        assert "a@test.com" in result["errors"][0]["message"]

    def test_multi_column_unique_pass(self):
        """多列联合唯一性验证通过"""
        datasets = {
            "orders": pd.DataFrame(
                {
                    "user_id": [1, 1, 2],
                    "product_id": [100, 200, 100],
                }
            )
        }
        constraint = UniqueConstraint(table="orders", column=["user_id", "product_id"])
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_multi_column_unique_fail(self):
        """多列联合唯一性验证失败"""
        datasets = {
            "orders": pd.DataFrame(
                {
                    "user_id": [1, 1, 1],
                    "product_id": [100, 100, 100],
                }
            )
        }
        constraint = UniqueConstraint(table="orders", column=["user_id", "product_id"])
        result = constraint.validate(datasets)

        assert len(result["errors"]) > 0
        assert result["errors"][0]["error_type"] == "UniqueViolation"

    def test_table_not_found(self):
        """表不存在时返回配置错误"""
        datasets = {}
        constraint = UniqueConstraint(table="missing", column="email")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_column_not_found(self):
        """列不存在时返回配置错误"""
        datasets = {"users": pd.DataFrame({"id": [1, 2, 3]})}
        constraint = UniqueConstraint(table="users", column="email")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_empty_column_raises(self):
        """空列名应抛出 ValueError"""
        with pytest.raises(ValueError, match="column 不能为空"):
            UniqueConstraint(table="users", column="")

    def test_empty_table_raises(self):
        """空表名应抛出 ValueError"""
        with pytest.raises(ValueError, match="table 不能为空"):
            UniqueConstraint(table="", column="email")

    def test_get_constraint_info(self):
        """约束信息返回正确"""
        constraint = UniqueConstraint(table="users", column="email")
        info = constraint.get_constraint_info()

        assert info["constraint_type"] == "UniqueConstraint"
        assert info["table"] == "users"
        assert "email" in info["description"]
