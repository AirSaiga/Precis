"""测试 Transform 注册表和工厂函数"""

from __future__ import annotations

import pytest

from app.shared.domain.transforms.base import TransformRunner
from app.shared.domain.transforms.registry import TRANSFORM_REGISTRY, create_runner


class TestTransformRegistry:
    """测试 TRANSFORM_REGISTRY 注册表"""

    def test_registry_has_all_expected_types(self):
        expected_types = {
            "StringSplit",
            "RegexExtract",
            "MathExpr",
            "DateFormat",
            "Lookup",
            "Strip",
            "UpperCase",
            "LowerCase",
            "Replace",
            "FillNA",
            "CastType",
            "Concat",
            "Substring",
            "ConditionalAssign",
            "Digits",
            "WeightedSum",
            "Modulo",
            "MapValue",
            "FilterRows",
            "DropDuplicates",
            "Aggregate",
            "SortRows",
        }
        assert set(TRANSFORM_REGISTRY.keys()) == expected_types

    def test_all_values_are_transform_runner_subclasses(self):
        for name, cls in TRANSFORM_REGISTRY.items():
            assert issubclass(cls, TransformRunner), f"{name} 不是 TransformRunner 子类"

    def test_all_can_be_instantiated(self):
        for name, cls in TRANSFORM_REGISTRY.items():
            instance = cls()
            assert isinstance(instance, TransformRunner), f"{name} 实例化失败"


class TestCreateRunner:
    """测试 create_runner 工厂函数"""

    def test_create_all_registered_runners(self):
        for type_name in TRANSFORM_REGISTRY:
            runner = create_runner(type_name)
            assert isinstance(runner, TransformRunner)

    def test_create_unknown_runner_raises(self):
        with pytest.raises(ValueError) as exc_info:
            create_runner("UnknownType")
        assert "未注册的 Transform 类型" in str(exc_info.value)
        assert "UnknownType" in str(exc_info.value)
