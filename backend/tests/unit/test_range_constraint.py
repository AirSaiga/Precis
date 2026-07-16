"""区间约束单元测试"""

from decimal import Decimal

import pandas as pd
import pytest

from app.shared.domain.constraints.range import RangeConstraint


class TestRangeConstraint:
    """RangeConstraint 单元测试"""

    def test_inclusive_range_pass(self):
        """闭区间内验证通过"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [10, 50, 100],
                }
            )
        }
        constraint = RangeConstraint(
            table="products", column="price", min_value=0, max_value=100, boundary_mode="inclusive"
        )
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_inclusive_range_fail(self):
        """闭区间内验证失败"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [-10, 50, 150],
                }
            )
        }
        constraint = RangeConstraint(
            table="products", column="price", min_value=0, max_value=100, boundary_mode="inclusive"
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 2
        assert result["errors"][0]["error_type"] == "RangeViolation"

    def test_exclusive_range_pass(self):
        """开区间内验证通过"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [1, 50, 99],
                }
            )
        }
        constraint = RangeConstraint(
            table="products", column="price", min_value=0, max_value=100, boundary_mode="exclusive"
        )
        result = constraint.validate(datasets)

        assert result["errors"] == []

    def test_exclusive_range_fail(self):
        """开区间内边界值验证失败"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [0, 50, 100],
                }
            )
        }
        constraint = RangeConstraint(
            table="products", column="price", min_value=0, max_value=100, boundary_mode="exclusive"
        )
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 2

    def test_min_only(self):
        """仅最小值约束"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "quantity": [0, 5, 10],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="quantity", min_value=1, boundary_mode="inclusive")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["value"] == 0

    def test_max_only(self):
        """仅最大值约束"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "quantity": [50, 100, 150],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="quantity", max_value=100, boundary_mode="inclusive")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["value"] == 150

    def test_invalid_boundary_mode(self):
        """无效边界模式应抛出 ValueError"""
        with pytest.raises(ValueError, match="boundary_mode"):
            RangeConstraint(table="products", column="price", boundary_mode="invalid")

    def test_min_greater_than_max(self):
        """min > max 应抛出 ValueError"""
        with pytest.raises(ValueError, match="min_value"):
            RangeConstraint(table="products", column="price", min_value=100, max_value=0)

    def test_decimal_large_value_precision_preserved(self):
        """回归 D9: Decimal 列的大额整数值不应因转 float64 丢精度导致边界误判。

        业务场景:金融金额用 decimal 类型,常为大额整数(如 18 位)。
        原实现 pd.to_numeric 把 Decimal 转 float64(float64 仅 ~15-17 位有效数字),
        123456789012345678 → 1.2345678901234566e+17,与边界比较时精度丢失,可能误判。
        要求:Decimal 列的比较在 Decimal 空间进行,边界判定精确。
        """
        # 18 位大额整数,在 float64 下会丢精度(123456789012345678 != float(123456789012345678))
        big_value = Decimal("123456789012345678")
        # 上限恰好等于该值(闭区间应通过)。float64 下 big_value 会被舍入成不同值,导致 ≠ 上限而误报
        datasets = {
            "accounts": pd.DataFrame({"balance": [big_value]}, dtype=object),
        }
        constraint = RangeConstraint(
            table="accounts",
            column="balance",
            min_value=Decimal("0"),
            max_value=big_value,  # 闭区间,值恰好等于上限 → 应通过
            boundary_mode="inclusive",
        )
        result = constraint.validate(datasets)
        assert result["errors"] == [], f"Decimal 大额值等于上限(闭区间)应通过,实际误报: {result['errors']}"

    def test_decimal_large_value_correctly_detected_as_violation(self):
        """回归 D9: Decimal 大额值真正越界时也应正确检出(不能因丢精度而漏报)。"""
        # 值比上限大 1(18 位),float64 下两者可能被舍入成相同值 → 漏报
        datasets = {
            "accounts": pd.DataFrame({"balance": [Decimal("123456789012345679")]}, dtype=object),
        }
        constraint = RangeConstraint(
            table="accounts",
            column="balance",
            max_value=Decimal("123456789012345678"),  # 上限比值小 1 → 应报越界
            boundary_mode="inclusive",
        )
        result = constraint.validate(datasets)
        assert len(result["errors"]) == 1, f"Decimal 值比上限大 1 应正确检出越界,实际: {result['errors']}"

    def test_table_not_found(self):
        """表不存在时返回配置错误"""
        datasets = {}
        constraint = RangeConstraint(table="missing", column="price")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_column_not_found(self):
        """列不存在时返回配置错误"""
        datasets = {"products": pd.DataFrame({"id": [1, 2, 3]})}
        constraint = RangeConstraint(table="products", column="missing")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_non_numeric_column(self):
        """非数值列返回配置错误"""
        datasets = {
            "products": pd.DataFrame(
                {
                    "name": ["Apple", "Banana", "Cherry"],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="name")
        result = constraint.validate(datasets)

        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"

    def test_get_description_full_range(self):
        """完整范围描述正确"""
        constraint = RangeConstraint(table="products", column="price", min_value=0, max_value=100)
        assert "[0, 100]" in constraint._get_description()

    def test_get_description_min_only(self):
        """仅最小值描述正确"""
        constraint = RangeConstraint(table="products", column="price", min_value=0)
        assert ">= 0" in constraint._get_description()


class TestRangeConstraintEdgeCases:
    """覆盖 range.py 的未覆盖分支"""

    def test_decimal_type(self):
        from decimal import Decimal

        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [Decimal("10.5"), Decimal("20.0")],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="price", min_value=0, max_value=100)
        result = constraint.validate(datasets)
        assert result["errors"] == []

    def test_convertible_string_type(self):
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": ["10", "20", "30"],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="price", min_value=0, max_value=100)
        result = constraint.validate(datasets)
        # Strings are rejected even if convertible
        assert len(result["errors"]) == 1
        assert "数值类型" in result["errors"][0]["message"]

    def test_non_convertible_type(self):
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": ["abc", "def"],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="price", min_value=0, max_value=100)
        result = constraint.validate(datasets)
        assert len(result["errors"]) == 1
        assert "数值类型" in result["errors"][0]["message"]

    def test_only_min_value(self):
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [5, 10, 15],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="price", min_value=10, max_value=None)
        result = constraint.validate(datasets)
        assert len(result["errors"]) == 1
        assert "不满足 >=" in result["errors"][0]["message"]

    def test_only_max_value(self):
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [5, 10, 15],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="price", min_value=None, max_value=10)
        result = constraint.validate(datasets)
        assert len(result["errors"]) == 1
        assert "不满足 <=" in result["errors"][0]["message"]

    def test_neither_min_nor_max(self):
        datasets = {
            "products": pd.DataFrame(
                {
                    "price": [5, 10, 15],
                }
            )
        }
        constraint = RangeConstraint(table="products", column="price", min_value=None, max_value=None)
        result = constraint.validate(datasets)
        # No bounds means no validation errors
        assert result["errors"] == []
