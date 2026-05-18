"""条件注册表单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)


import pandas as pd

from app.shared.domain.constraints.condition_registry import (
    CONDITION_REGISTRY,
    register_condition,
)


class TestConditionRegistry:
    """条件注册表单元测试"""

    def test_register_condition_decorator(self):
        """register_condition 装饰器可以注册新条件函数"""

        @register_condition("test_always_true")
        def _test_always_true(value):
            return True

        assert "test_always_true" in CONDITION_REGISTRY
        assert CONDITION_REGISTRY["test_always_true"]("anything") is True

        # 清理
        del CONDITION_REGISTRY["test_always_true"]

    def test_is_not_empty_empty_string(self):
        """is_not_empty 对空字符串返回 False"""
        assert CONDITION_REGISTRY["is_not_empty"]("") is False

    def test_is_not_empty_nan(self):
        """is_not_empty 对 NaN 返回 False"""
        assert CONDITION_REGISTRY["is_not_empty"](float("nan")) is False
        assert CONDITION_REGISTRY["is_not_empty"](pd.NA) is False
        assert CONDITION_REGISTRY["is_not_empty"](None) is False

    def test_is_not_empty_normal_values(self):
        """is_not_empty 对正常值返回 True"""
        assert CONDITION_REGISTRY["is_not_empty"]("hello") is True
        assert CONDITION_REGISTRY["is_not_empty"](0) is True
        assert CONDITION_REGISTRY["is_not_empty"](False) is True
        assert CONDITION_REGISTRY["is_not_empty"]("   ") is True

    def test_is_positive_number_positive(self):
        """is_positive_number 对正数返回 True"""
        assert CONDITION_REGISTRY["is_positive_number"](1) is True
        assert CONDITION_REGISTRY["is_positive_number"](1.5) is True
        assert CONDITION_REGISTRY["is_positive_number"]("3.14") is True

    def test_is_positive_number_negative(self):
        """is_positive_number 对负数返回 False"""
        assert CONDITION_REGISTRY["is_positive_number"](-1) is False
        assert CONDITION_REGISTRY["is_positive_number"]("-2.5") is False

    def test_is_positive_number_zero(self):
        """is_positive_number 对 0 返回 False"""
        assert CONDITION_REGISTRY["is_positive_number"](0) is False
        assert CONDITION_REGISTRY["is_positive_number"]("0") is False
        assert CONDITION_REGISTRY["is_positive_number"](0.0) is False

    def test_is_positive_number_non_numeric(self):
        """is_positive_number 对非数字返回 False"""
        assert CONDITION_REGISTRY["is_positive_number"]("abc") is False
        assert CONDITION_REGISTRY["is_positive_number"](None) is False
        assert CONDITION_REGISTRY["is_positive_number"]("") is False

    def test_override_registered_condition_warning(self, capsys):
        """覆盖已注册条件时应输出警告"""

        @register_condition("test_override")
        def _original(value):
            return True

        captured = capsys.readouterr()
        # 首次注册不应有警告
        assert "警告" not in captured.out

        @register_condition("test_override")
        def _override(value):
            return False

        captured = capsys.readouterr()
        assert "警告" in captured.out
        assert "test_override" in captured.out

        # 确认已被覆盖
        assert CONDITION_REGISTRY["test_override"]("x") is False

        # 清理
        del CONDITION_REGISTRY["test_override"]
