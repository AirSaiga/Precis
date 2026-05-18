"""
@fileoverview 高级数据类型单元测试

测试 ExtractedType、SequenceType、ExpressionType、SpecificExpressionType、
CompositeConditionType、SpecificCompositeConditionType 的 validate() 和 parse() 方法。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import re

import pytest

from app.shared.domain.data_types_parts.composite import CompositeConditionType, SpecificCompositeConditionType
from app.shared.domain.data_types_parts.expression import ExpressionType, SpecificExpressionType
from app.shared.domain.data_types_parts.extracted import ExtractedType
from app.shared.domain.data_types_parts.scalars import IntegerType, StringType
from app.shared.domain.data_types_parts.sequence import SequenceType
from app.shared.domain.expression_system import ExpressionPattern, ExpressionRegistry


class TestExtractedType:
    def test_validate_always_true(self):
        et = ExtractedType(source_column="email", extract_key="username")
        assert et.validate("anything") == (True, None)
        assert et.validate(None) == (True, None)
        assert et.validate(123) == (True, None)

    def test_parse_returns_value(self):
        et = ExtractedType(source_column="email", extract_key="username")
        assert et.parse("user@example.com") == "user@example.com"
        assert et.parse(42) == 42

    def test_init_attributes(self):
        et = ExtractedType(source_column="col1", extract_key="key1")
        assert et.source_column == "col1"
        assert et.extract_key == "key1"
        assert et.name == "Extracted"


class TestSequenceType:
    def test_validate_integer_sequence_pass(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        assert st.validate("1;2;3") == (True, None)

    def test_validate_with_empty_elements(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        assert st.validate("1;;3") == (True, None)

    def test_validate_empty_string(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        assert st.validate("") == (True, None)
        assert st.validate("   ") == (True, None)

    def test_validate_non_string_fail(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        valid, error = st.validate(123)
        assert valid is False
        assert "期望是字符串" in error

    def test_validate_element_fail(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        valid, error = st.validate("1;abc;3")
        assert valid is False
        assert "第 2 个元素" in error
        assert "abc" in error

    def test_parse_integer_sequence(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        assert st.parse("1;2;3") == [1, 2, 3]

    def test_parse_with_empty_and_whitespace(self):
        st = SequenceType(item_type=StringType(), delimiter=",")
        assert st.parse(" a ,  , c ") == ["a", "c"]

    def test_parse_non_string_returns_empty(self):
        st = SequenceType(item_type=IntegerType(), delimiter=";")
        assert st.parse(123) == []
        assert st.parse("") == []

    def test_custom_delimiter(self):
        st = SequenceType(item_type=StringType(), delimiter="|")
        assert st.validate("a|b|c") == (True, None)
        assert st.parse("a|b|c") == ["a", "b", "c"]


def _make_registry():
    """创建带两个模式的 ExpressionRegistry 用于测试。"""
    registry = ExpressionRegistry()
    # add pattern: add(a,b)
    registry.register(
        ExpressionPattern(
            name="add",
            regex=re.compile(r"^add\((?P<a>\d+),(?P<b>\d+)\)$"),
            parser_func=lambda d: {"a": int(d["a"]), "b": int(d["b"])},
        )
    )
    # mul pattern: mul(a,b)
    registry.register(
        ExpressionPattern(
            name="mul",
            regex=re.compile(r"^mul\((?P<x>\d+),(?P<y>\d+)\)$"),
            parser_func=lambda d: {"x": int(d["x"]), "y": int(d["y"])},
        )
    )
    return registry


class TestExpressionType:
    def test_validate_match_pass(self):
        registry = _make_registry()
        et = ExpressionType(registry)
        assert et.validate("add(1,2)") == (True, None)

    def test_validate_no_match_fail(self):
        registry = _make_registry()
        et = ExpressionType(registry)
        valid, error = et.validate("unknown(1,2)")
        assert valid is False
        assert "不匹配任何已注册的表达式格式" in error

    def test_validate_non_string_fail(self):
        registry = _make_registry()
        et = ExpressionType(registry)
        valid, error = et.validate(123)
        assert valid is False
        assert "期望是字符串" in error

    def test_validate_parser_error_fail(self):
        registry = ExpressionRegistry()
        registry.register(
            ExpressionPattern(
                name="bad",
                regex=re.compile(r"^bad\((?P<v>\w+)\)$"),
                parser_func=lambda d: (_ for _ in ()).throw(ValueError("bad value")),
            )
        )
        et = ExpressionType(registry)
        valid, error = et.validate("bad(x)")
        assert valid is False
        assert "内容无效" in error

    def test_parse_success(self):
        registry = _make_registry()
        et = ExpressionType(registry)
        result = et.parse("add(3,4)")
        assert result == {"type": "add", "value": {"a": 3, "b": 4}}


class TestSpecificExpressionType:
    def test_validate_specific_pass(self):
        registry = _make_registry()
        st = SpecificExpressionType(registry, pattern="add")
        assert st.validate("add(10,20)") == (True, None)

    def test_validate_specific_no_match_fail(self):
        registry = _make_registry()
        st = SpecificExpressionType(registry, pattern="add")
        valid, error = st.validate("mul(1,2)")
        assert valid is False
        assert "不匹配指定的表达式格式" in error

    def test_validate_non_string_fail(self):
        registry = _make_registry()
        st = SpecificExpressionType(registry, pattern="add")
        valid, error = st.validate(123)
        assert valid is False

    def test_validate_parser_error_fail(self):
        registry = ExpressionRegistry()
        registry.register(
            ExpressionPattern(
                name="add",
                regex=re.compile(r"^add\((?P<a>\w+),(?P<b>\w+)\)$"),
                parser_func=lambda d: (_ for _ in ()).throw(ValueError("bad arg")),
            )
        )
        st = SpecificExpressionType(registry, pattern="add")
        valid, error = st.validate("add(x,y)")
        assert valid is False
        assert "内容无效" in error

    def test_parse_success(self):
        registry = _make_registry()
        st = SpecificExpressionType(registry, pattern="add")
        result = st.parse("add(5,6)")
        assert result == {"type": "add", "value": {"a": 5, "b": 6}}

    def test_init_pattern_not_found(self):
        registry = _make_registry()
        with pytest.raises(ValueError, match="未找到指定的模式"):
            SpecificExpressionType(registry, pattern="nonexistent")

    def test_init_string_regex_compiled(self):
        registry = ExpressionRegistry()
        registry.register(
            ExpressionPattern(
                name="str_regex",
                regex=r"^str\((?P<v>\w+)\)$",
                parser_func=lambda d: d,
            )
        )
        st = SpecificExpressionType(registry, pattern="str_regex")
        assert st.validate("str(hello)") == (True, None)


class TestCompositeConditionType:
    def test_validate_and_pass(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        assert ct.validate("add(1,2) and mul(3,4)") == (True, None)

    def test_validate_or_pass(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="or")
        assert ct.validate("add(1,2) or add(3,4)") == (True, None)

    def test_validate_empty_string(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        assert ct.validate("") == (True, None)
        assert ct.validate("   ") == (True, None)

    def test_validate_non_string_fail(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        valid, error = ct.validate(123)
        assert valid is False
        assert "期望是字符串" in error

    def test_validate_subclause_no_match_fail(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        valid, error = ct.validate("add(1,2) AND unknown(3,4)")
        assert valid is False
        assert "不匹配任何已知的模式" in error

    def test_validate_empty_subclause_fail(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        # Empty element at start: " and add(1,2)" splits to ["", "add(1,2)"]
        valid, error = ct.validate(" and add(1,2)")
        assert valid is False
        assert "空的条件表达式" in error
        # Empty element at end: "add(1,2) and " splits to ["add(1,2)", ""]
        valid2, error2 = ct.validate("add(1,2) and ")
        assert valid2 is False
        assert "空的条件表达式" in error2

    def test_validate_parser_error_in_subclause(self):
        registry = ExpressionRegistry()
        registry.register(
            ExpressionPattern(
                name="bad",
                regex=re.compile(r"^bad\((?P<v>\w+)\)$"),
                parser_func=lambda d: (_ for _ in ()).throw(ValueError("err")),
            )
        )
        ct = CompositeConditionType(registry, logical_op="and")
        valid, error = ct.validate("bad(x)")
        assert valid is False
        assert "验证失败" in error

    def test_parse_success(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        result = ct.parse("add(1,2) and mul(3,4)")
        assert result == [
            {"type": "add", "value": {"a": 1, "b": 2}},
            {"type": "mul", "value": {"x": 3, "y": 4}},
        ]

    def test_parse_empty_string(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        assert ct.parse("") == []
        assert ct.parse("   ") == []

    def test_parse_skips_empty_parts(self):
        registry = _make_registry()
        ct = CompositeConditionType(registry, logical_op="and")
        # " and add(1,2)" splits to ["", "add(1,2)"]; empty part is skipped
        result = ct.parse(" and add(1,2)")
        assert result == [{"type": "add", "value": {"a": 1, "b": 2}}]


class TestSpecificCompositeConditionType:
    def test_validate_specific_pass(self):
        registry = _make_registry()
        sct = SpecificCompositeConditionType(registry, pattern="add", logical_op="and")
        assert sct.validate("add(1,2) and add(3,4)") == (True, None)

    def test_validate_specific_subclause_no_match(self):
        registry = _make_registry()
        sct = SpecificCompositeConditionType(registry, pattern="add", logical_op="and")
        valid, error = sct.validate("add(1,2) AND mul(3,4)")
        assert valid is False

    def test_parse_success(self):
        registry = _make_registry()
        sct = SpecificCompositeConditionType(registry, pattern="add", logical_op="and")
        result = sct.parse("add(10,20) and add(30,40)")
        assert result == [
            {"type": "add", "value": {"a": 10, "b": 20}},
            {"type": "add", "value": {"a": 30, "b": 40}},
        ]

    def test_init_pattern_not_found(self):
        registry = _make_registry()
        with pytest.raises(ValueError, match="未找到指定的模式"):
            SpecificCompositeConditionType(registry, pattern="nonexistent", logical_op="and")
