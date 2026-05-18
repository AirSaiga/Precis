"""外键约束单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import numpy as np
import pandas as pd

from app.shared.domain.constraints.foreign_key import ForeignKeyConstraints


class TestForeignKeyConstraint:
    """ForeignKeyConstraints 单元测试"""

    def test_foreign_key_pass(self):
        """所有外键值都存在于目标表中，验证通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "name": ["alice", "bob", "charlie"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "order_id": [101, 102, 103],
                    "user_id": [1, 2, 3],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []
        assert result["info"]["constraint_type"] == "ForeignKeyConstraints"

    def test_foreign_key_fail(self):
        """存在外键值不在目标表中，验证失败"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "name": ["alice", "bob", "charlie"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "order_id": [101, 102, 103],
                    "user_id": [1, 2, 99],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ForeignKeyViolation"
        assert result["errors"][0]["row_index"] == 2
        assert result["errors"][0]["value"] == 99
        assert "99" in result["errors"][0]["message"]

    def test_foreign_key_null_ignored(self):
        """空值（None/NaN/空字符串）不视为违规"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "name": ["alice", "bob", "charlie"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "order_id": [101, 102, 103, 104],
                    "user_id": [1, None, np.nan, ""],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_value_normalization_string_trim(self):
        """字符串前后空格应被去除"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": ["alice", "bob"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "user_id": [" alice ", "bob"],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_value_normalization_float_string(self):
        """字符串 '123.0' 应被规范化为 '123'"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [123, 456],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "user_id": ["123.0", "456.00"],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_value_normalization_int_to_str(self):
        """整数应被规范化为字符串进行比较"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": ["1", "2", "3"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "user_id": [1, 2, 3],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_value_normalization_float_to_str(self):
        """浮点数应被规范化为字符串进行比较"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": ["1", "2", "3"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "user_id": [1.0, 2.0, 3.0],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_value_normalization_bool_to_str(self):
        """布尔值应被规范化为字符串进行比较"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": ["True", "False"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "user_id": [True, False],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_value_normalization_non_integer_float(self):
        """非整数浮点数应被规范化为字符串进行比较"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": ["1.5", "2.3"],
                }
            ),
            "orders": pd.DataFrame(
                {
                    "user_id": [1.5, 2.3],
                }
            ),
        }
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_from_table_not_found(self):
        """from_table 不存在时返回配置错误"""
        datasets = {"users": pd.DataFrame({"id": [1, 2, 3]})}
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_to_table_not_found(self):
        """to_table 不存在时返回配置错误"""
        datasets = {"orders": pd.DataFrame({"user_id": [1, 2, 3]})}
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_from_column_not_found(self):
        """from_column 不存在时返回配置错误"""
        datasets = {"users": pd.DataFrame({"id": [1, 2, 3]}), "orders": pd.DataFrame({"order_id": [101, 102]})}
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_to_column_not_found(self):
        """to_column 不存在时返回配置错误"""
        datasets = {"users": pd.DataFrame({"name": ["alice", "bob"]}), "orders": pd.DataFrame({"user_id": [1, 2]})}
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_get_constraint_info(self):
        """约束信息返回正确"""
        constraint = ForeignKeyConstraints(from_table="orders", from_column="user_id", to_table="users", to_column="id")
        info = constraint.get_constraint_info()

        assert info["constraint_type"] == "ForeignKeyConstraints"
        assert info["table"] == "orders"
        assert "orders.user_id" in info["description"]
        assert "users.id" in info["description"]
