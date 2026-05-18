"""条件约束单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import numpy as np
import pandas as pd
import pytest

from app.shared.domain.constraints.conditional import ConditionalConstraint


class TestConditionalConstraint:
    """ConditionalConstraint 单元测试"""

    # ------------------------------------------------------------------
    # 简单条件 (if_column + if_value)
    # ------------------------------------------------------------------

    def test_simple_condition_pass(self):
        """简单条件：满足条件时 then_column 也满足要求，验证通过"""
        datasets = {
            "customers": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "status": ["VIP", "Normal", "VIP"],
                    "credit_limit": [1500, 500, 2000],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="customers",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        result = constraint.validate(datasets)

        assert result["errors"] == []
        assert result["info"]["constraint_type"] == "ConditionalConstraint"

    def test_simple_condition_fail(self):
        """简单条件：满足条件时 then_column 不满足要求，验证失败"""
        datasets = {
            "customers": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "status": ["VIP", "Normal", "VIP"],
                    "credit_limit": [500, 2000, 800],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="customers",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 2
        assert result["errors"][0]["error_type"] == "ConditionalViolation"
        assert result["errors"][0]["row_index"] == 0
        assert result["errors"][0]["value"]["status"] == "VIP"
        assert result["errors"][0]["value"]["credit_limit"] == 500

    def test_simple_condition_not_all_rows_triggered(self):
        """简单条件：仅当 if_column == if_value 的行才触发检查"""
        datasets = {
            "customers": pd.DataFrame(
                {
                    "id": [1, 2],
                    "status": ["Normal", "Normal"],
                    "credit_limit": [500, 200],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="customers",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        result = constraint.validate(datasets)

        # 没有 VIP 行，所以不触发 then 条件检查
        assert result["errors"] == []

    # ------------------------------------------------------------------
    # 复合条件 (if_conditions + if_logic)
    # ------------------------------------------------------------------

    def test_composite_condition_and_pass(self):
        """复合条件 AND：所有条件都满足时触发，then_column 也通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "age": [20, 16, 25],
                    "country": ["CN", "CN", "US"],
                    "id_card": ["110101", "", "999999"],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_conditions=[
                {"column": "age", "operator": "greater_than", "value": 18},
                {"column": "country", "operator": "eq", "value": "CN"},
            ],
            if_logic="and",
            then_column="id_card",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_composite_condition_and_fail(self):
        """复合条件 AND：所有条件都满足时触发，then_column 不通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "age": [20, 16, 25],
                    "country": ["CN", "CN", "CN"],
                    "id_card": ["", "110101", "999999"],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_conditions=[
                {"column": "age", "operator": "greater_than", "value": 18},
                {"column": "country", "operator": "eq", "value": "CN"},
            ],
            if_logic="and",
            then_column="id_card",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConditionalViolation"
        # 第1行 (age=20, country=CN) 触发，但 id_card 为空
        assert result["errors"][0]["row_index"] == 0

    def test_composite_condition_or_pass(self):
        """复合条件 OR：任一条件满足时触发，then_column 也通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "age": [20, 16, 25],
                    "country": ["US", "CN", "US"],
                    "id_card": ["110101", "220202", "330303"],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_conditions=[
                {"column": "age", "operator": "greater_than", "value": 18},
                {"column": "country", "operator": "eq", "value": "CN"},
            ],
            if_logic="or",
            then_column="id_card",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_composite_condition_or_fail(self):
        """复合条件 OR：任一条件满足时触发，then_column 不通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "age": [20, 16, 15],
                    "country": ["US", "CN", "US"],
                    "id_card": ["", "", ""],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_conditions=[
                {"column": "age", "operator": "greater_than", "value": 18},
                {"column": "country", "operator": "eq", "value": "CN"},
            ],
            if_logic="or",
            then_column="id_card",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)

        # 第0行 (age>18) 和第1行 (country==CN) 都触发
        assert len(result["errors"]) == 2
        assert result["errors"][0]["row_index"] == 0
        assert result["errors"][1]["row_index"] == 1

    # ------------------------------------------------------------------
    # then_condition 各种操作符
    # ------------------------------------------------------------------

    def test_then_condition_not_null(self):
        """then_condition 为 not_null 操作符"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2],
                    "status": ["VIP", "VIP"],
                    "name": ["alice", ""],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_column="status",
            if_value="VIP",
            then_column="name",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_then_condition_in_pass(self):
        """then_condition 为 in 操作符，所有值都在列表中，验证通过"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "status": ["VIP", "VIP", "Normal"],
                    "level": ["A", "B", "C"],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_column="status",
            if_value="VIP",
            then_column="level",
            then_condition={"operator": "in", "values": ["A", "B"]},
        )
        result = constraint.validate(datasets)

        # 第0行 level=A (在 [A,B] 中) -> 通过
        # 第1行 level=B (在 [A,B] 中) -> 通过
        # 第2行 status=Normal -> 不触发
        assert result["errors"] == []

    def test_then_condition_in_fail(self):
        """then_condition 为 in 操作符，值不在列表中"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2, 3],
                    "status": ["VIP", "VIP", "Normal"],
                    "level": ["A", "C", "D"],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_column="status",
            if_value="VIP",
            then_column="level",
            then_condition={"operator": "in", "values": ["A", "B"]},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1
        assert result["errors"][0]["value"]["level"] == "C"

    def test_then_condition_registered_func(self):
        """then_condition 为已注册的字符串条件函数"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2],
                    "status": ["VIP", "VIP"],
                    "amount": [100, -50],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users", if_column="status", if_value="VIP", then_column="amount", then_condition="is_positive_number"
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1
        assert result["errors"][0]["value"]["amount"] == -50

    # ------------------------------------------------------------------
    # 配置错误场景
    # ------------------------------------------------------------------

    def test_table_not_found(self):
        """表不存在时返回配置错误"""
        datasets = {}
        constraint = ConditionalConstraint(
            table="missing",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "missing" in result["errors"][0]["message"]

    def test_then_column_not_found(self):
        """then_column 不存在时返回配置错误"""
        datasets = {"customers": pd.DataFrame({"id": [1, 2]})}
        constraint = ConditionalConstraint(
            table="customers",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "credit_limit" in result["errors"][0]["message"]

    def test_if_column_not_found(self):
        """简单模式下 if_column 不存在时返回配置错误"""
        datasets = {
            "customers": pd.DataFrame(
                {
                    "id": [1, 2],
                    "credit_limit": [1000, 2000],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="customers",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "status" in result["errors"][0]["message"]

    def test_if_condition_column_not_found(self):
        """复合模式下 if_conditions 中的列不存在时返回配置错误"""
        datasets = {
            "users": pd.DataFrame(
                {
                    "id": [1, 2],
                    "country": ["CN", "US"],
                }
            )
        }
        constraint = ConditionalConstraint(
            table="users",
            if_conditions=[
                {"column": "age", "operator": "greater_than", "value": 18},
            ],
            if_logic="and",
            then_column="id",
            then_condition={"operator": "not_null"},
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "age" in result["errors"][0]["message"]

    # ------------------------------------------------------------------
    # 初始化校验场景
    # ------------------------------------------------------------------

    def test_unsupported_dsl_operator_raises(self):
        """不支持的 DSL 操作符应抛出 ValueError"""
        with pytest.raises(ValueError, match="不支持的DSL操作符"):
            ConditionalConstraint(
                table="users",
                if_column="status",
                if_value="VIP",
                then_column="name",
                then_condition={"operator": "unknown_op"},
            )

    def test_unregistered_condition_name_raises(self):
        """未注册的条件函数名应抛出 ValueError"""
        with pytest.raises(ValueError, match="未注册的条件函数名"):
            ConditionalConstraint(
                table="users",
                if_column="status",
                if_value="VIP",
                then_column="name",
                then_condition="non_existent_func",
            )

    def test_invalid_then_condition_type_raises(self):
        """不支持的 then_condition 类型应抛出 TypeError"""
        with pytest.raises(TypeError, match="then_condition配置类型不支持"):
            ConditionalConstraint(
                table="users", if_column="status", if_value="VIP", then_column="name", then_condition=12345
            )

    # ------------------------------------------------------------------
    # 信息接口
    # ------------------------------------------------------------------

    def test_get_constraint_info_simple(self):
        """简单条件模式下约束信息返回正确"""
        constraint = ConditionalConstraint(
            table="customers",
            if_column="status",
            if_value="VIP",
            then_column="credit_limit",
            then_condition={"operator": "greater_than", "value": 1000},
        )
        info = constraint.get_constraint_info()

        assert info["constraint_type"] == "ConditionalConstraint"
        assert info["table"] == "customers"
        assert "status" in info["description"]
        assert "credit_limit" in info["description"]

    def test_get_constraint_info_composite(self):
        """复合条件模式下约束信息返回正确"""
        constraint = ConditionalConstraint(
            table="users",
            if_conditions=[{"column": "age", "operator": "greater_than", "value": 18}],
            if_logic="and",
            then_column="id_card",
            then_condition={"operator": "not_null"},
        )
        info = constraint.get_constraint_info()

        assert info["constraint_type"] == "ConditionalConstraint"
        assert info["table"] == "users"
        assert "满足条件时" in info["description"]
        assert "id_card" in info["description"]


class TestConditionalConstraintEdgeCases:
    """覆盖 conditional.py 的未覆盖分支"""

    def test_safe_greater_than_nan(self):
        datasets = {"t": pd.DataFrame({"a": [np.nan], "b": [1]})}
        constraint = ConditionalConstraint(
            table="t",
            if_column="a",
            if_value="x",
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        result = constraint.validate(datasets)
        assert result["errors"] == []

    def test_safe_greater_than_none_threshold(self):
        datasets = {"t": pd.DataFrame({"a": ["x"], "b": [1]})}
        constraint = ConditionalConstraint(
            table="t",
            if_column="a",
            if_value="x",
            then_column="b",
            then_condition={"operator": "greater_than", "value": None},
        )
        result = constraint.validate(datasets)
        # None threshold means condition always fails
        assert len(result["errors"]) == 1

    def test_safe_greater_than_exception(self):
        datasets = {"t": pd.DataFrame({"a": ["x"], "b": ["not_a_number"]})}
        constraint = ConditionalConstraint(
            table="t",
            if_column="a",
            if_value="x",
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        result = constraint.validate(datasets)
        assert len(result["errors"]) == 1

    def test_safe_in_nan(self):
        datasets = {"t": pd.DataFrame({"a": ["x"], "b": [np.nan]})}
        constraint = ConditionalConstraint(
            table="t", if_column="a", if_value="x", then_column="b", then_condition={"operator": "in", "values": [1, 2]}
        )
        result = constraint.validate(datasets)
        assert len(result["errors"]) == 1

    def test_condition_to_string_unknown(self):
        constraint = ConditionalConstraint(
            table="t",
            if_column="a",
            if_value="x",
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        # Override to test _condition_to_string with unknown type
        constraint.then_condition_config = 123
        assert "未知规则" in constraint._condition_to_string()

    def test_apply_if_not_null(self):
        datasets = {"t": pd.DataFrame({"a": [1, np.nan, ""], "b": [1, 2, 3]})}
        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "a", "operator": "not_null"}],
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        result = constraint.validate(datasets)
        assert result["errors"] == []

    def test_apply_if_in(self):
        datasets = {"t": pd.DataFrame({"a": ["x", "y", "z"], "b": [1, 2, 3]})}
        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "a", "operator": "in", "values": ["x", "y"]}],
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        result = constraint.validate(datasets)
        assert result["errors"] == []

    def test_apply_if_greater_than_exception(self):
        datasets = {"t": pd.DataFrame({"a": ["not_a_number"], "b": [1]})}
        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "a", "operator": "greater_than", "value": 0}],
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        result = constraint.validate(datasets)
        assert result["errors"] == []

    def test_apply_if_neq(self):
        datasets = {"t": pd.DataFrame({"a": ["x", "y"], "b": [1, 2]})}
        constraint = ConditionalConstraint(
            table="t",
            if_conditions=[{"column": "a", "operator": "neq", "value": "x"}],
            then_column="b",
            then_condition={"operator": "greater_than", "value": 0},
        )
        result = constraint.validate(datasets)
        assert result["errors"] == []
