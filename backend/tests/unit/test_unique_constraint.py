"""唯一性约束单元测试"""

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

    def test_nulls_exempt_from_uniqueness(self):
        """回归 #4: 可空唯一列的多个空值不应被判为重复。

        业务场景:软唯一约束(邮箱填了才唯一/税号有则唯一)是高频模式,SQL 及主流数据
        质量工具的唯一性语义均豁免 NULL。原实现 df.duplicated(keep=False) 把 NaN 视为
        彼此相等,≥2 个空行全部报 UniqueViolation: 值 'None' 不唯一。
        本测试要求:多行空值零报错,真实重复值仍正确报出。
        """
        datasets = {
            "users": pd.DataFrame(
                {
                    # 两个空值 + 一个真实重复("dup")
                    "code": ["dup", None, None, "dup", "unique"],
                }
            )
        }
        constraint = UniqueConstraint(table="users", column="code")
        result = constraint.validate(datasets)

        violations = [e for e in result["errors"] if e["error_type"] == "UniqueViolation"]
        # 只应报真实重复 "dup"(2 行),空值不应报
        assert len(violations) == 2, f"应只报真实重复 'dup' 2行,实际报 {len(violations)} 条: {violations}"
        for v in violations:
            assert v["value"] == "dup", f"不应报空值,实际: {v['value']}"

    def test_multi_column_nulls_exempt_from_uniqueness(self):
        """回归 #4: 多列联合唯一的空值组合也应豁免。"""
        datasets = {
            "orders": pd.DataFrame(
                {
                    # (1,100)重复,但 (None,None) 两行 + (1,None)+(None,100) 各类空值组合不应报
                    "user_id": [1, 1, None, None, 1],
                    "product_id": [100, 100, None, None, None],
                }
            )
        }
        constraint = UniqueConstraint(table="orders", column=["user_id", "product_id"])
        result = constraint.validate(datasets)

        violations = [e for e in result["errors"] if e["error_type"] == "UniqueViolation"]
        # 仅 (1,100) 这一对真实重复报错(2行)
        assert len(violations) == 2, f"应只报 (1,100) 真实重复 2行,实际: {violations}"
        for v in violations:
            assert v["value"] == {"user_id": 1, "product_id": 100}

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
