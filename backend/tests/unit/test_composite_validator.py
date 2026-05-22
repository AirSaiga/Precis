"""
@fileoverview 复合约束校验器单元测试

功能概述:
- 测试 CompositeValidator 的 all/any/none 三种逻辑策略
- 测试空子约束列表、全部禁用子约束的边界情况
- 测试子约束异常时的容错行为

架构设计:
- 使用 pytest + pandas 构建测试 DataFrame
- 直接实例化 CompositeValidator，不依赖 UnifiedValidationService 注册表
"""

from __future__ import annotations

import pandas as pd
import pytest

from app.shared.services.validation.validators.composite import CompositeValidator


class TestCompositeValidator:
    """CompositeValidator 单元测试"""

    @pytest.fixture
    def validator(self):
        """提供 CompositeValidator 实例"""
        return CompositeValidator()

    @pytest.fixture
    def df_notnull(self):
        """包含空值的测试数据"""
        # 使用 dtype=object 确保空字符串被 NotNullConstraint 正确检测
        return pd.DataFrame({"name": ["Alice", "", "Bob", "Charlie"]}, dtype=object)

    @pytest.fixture
    def df_unique(self):
        """包含重复值的测试数据"""
        return pd.DataFrame({"id": ["a", "b", "a", "c"]})

    @pytest.fixture
    def df_clean(self):
        """无问题的测试数据"""
        return pd.DataFrame({"name": ["Alice", "Bob", "Charlie"]})

    def test_empty_sub_constraints_returns_valid(self, validator, df_clean):
        """空子约束列表应视为通过"""
        result = validator.validate(df_clean, "name", logic="all", sub_constraints=[])
        assert result.is_valid is True
        assert result.error_count == 0

    def test_all_logic_with_failing_sub_constraints(self, validator, df_notnull):
        """logic=all 时，任一子约束失败则整体失败"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="all",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is False
        assert result.error_count > 0

    def test_all_logic_with_multiple_failing(self, validator, df_notnull):
        """logic=all 时，多个子约束失败应收集所有错误"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="all",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is False
        # 两个相同的 NotNull 约束各产生 1 个错误，共 2 个
        assert result.error_count == 2

    def test_all_logic_with_passing_sub_constraints(self, validator, df_clean):
        """logic=all 时，全部子约束通过则整体通过"""
        result = validator.validate(
            df_clean,
            "name",
            logic="all",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is True
        assert result.error_count == 0

    def test_any_logic_with_one_passing(self, validator, df_notnull):
        """logic=any 时，至少一个子约束通过则整体通过"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="any",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
                {"type": "Unique", "enabled": True, "params": {}},
            ],
        )
        # NotNull 失败（有空值），Unique 通过（name 列无重复）
        # 至少一个通过，所以整体通过
        assert result.is_valid is True
        assert result.error_count == 0

    def test_any_logic_with_all_failing(self, validator, df_notnull):
        """logic=any 时，全部子约束失败则整体失败"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="any",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is False
        assert result.error_count == 1  # 聚合为一条复合错误消息
        assert "any" in result.error_rows[0]["error_message"]

    def test_none_logic_with_all_failing(self, validator, df_notnull):
        """logic=none 时，全部子约束失败则整体通过"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="none",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is True
        assert result.error_count == 0

    def test_none_logic_with_one_passing(self, validator, df_clean):
        """logic=none 时，任一子约束通过则整体失败"""
        result = validator.validate(
            df_clean,
            "name",
            logic="none",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is False
        assert result.error_count == 1
        assert "none" in result.error_rows[0]["error_message"]

    def test_disabled_sub_constraints_are_skipped(self, validator, df_notnull):
        """禁用的子约束应被跳过"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="all",
            sub_constraints=[
                {"type": "NotNull", "enabled": False, "params": {}},
            ],
        )
        assert result.is_valid is True
        assert result.error_count == 0

    def test_all_disabled_sub_constraints_returns_valid(self, validator, df_notnull):
        """全部子约束禁用时视为通过"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="all",
            sub_constraints=[
                {"type": "NotNull", "enabled": False, "params": {}},
                {"type": "Unique", "enabled": False, "params": {}},
            ],
        )
        assert result.is_valid is True
        assert result.error_count == 0

    def test_unknown_logic_fallback_to_all(self, validator, df_notnull):
        """未知 logic 策略回退到 all 行为"""
        result = validator.validate(
            df_notnull,
            "name",
            logic="unknown",
            sub_constraints=[
                {"type": "NotNull", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is False
        assert result.error_count > 0

    def test_invalid_sub_constraint_type_is_skipped(self, validator, df_clean):
        """不支持的子约束类型应被跳过"""
        result = validator.validate(
            df_clean,
            "name",
            logic="all",
            sub_constraints=[
                {"type": "UnknownType", "enabled": True, "params": {}},
            ],
        )
        assert result.is_valid is True
        assert result.error_count == 0

    def test_range_sub_constraint_params(self, validator):
        """Range 子约束参数传递测试"""
        df = pd.DataFrame({"age": [10, 25, 150, 30]})
        result = validator.validate(
            df,
            "age",
            logic="all",
            sub_constraints=[
                {
                    "type": "Range",
                    "enabled": True,
                    "params": {"min_value": 0, "max_value": 120, "boundary_mode": "inclusive"},
                },
            ],
        )
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.error_rows[0]["cell_value"] == 150

    def test_allowed_values_sub_constraint_params(self, validator):
        """AllowedValues 子约束参数传递测试"""
        df = pd.DataFrame({"status": ["active", "inactive", "deleted", "active"]})
        result = validator.validate(
            df,
            "status",
            logic="all",
            sub_constraints=[
                {
                    "type": "AllowedValues",
                    "enabled": True,
                    "params": {"allowed_values": ["active", "inactive", "pending"]},
                },
            ],
        )
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.error_rows[0]["cell_value"] == "deleted"
