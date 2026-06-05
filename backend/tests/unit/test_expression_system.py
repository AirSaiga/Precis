"""
@fileoverview 表达式系统单元测试

测试 expression_system 和 patterns/loader 模块。
"""

import os
import re
import sys
import tempfile

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.patterns.loader import load_patterns_from_config
from app.shared.domain.expression_system import (
    TYPE_CASTERS,
    ExpressionPattern,
    ExpressionRegistry,
    create_templated_parser,
)


class TestTypeCasters:
    def test_str(self):
        assert TYPE_CASTERS["str"]("hello") == "hello"

    def test_int(self):
        assert TYPE_CASTERS["int"]("42") == 42

    def test_float(self):
        assert TYPE_CASTERS["float"]("3.14") == 3.14

    def test_bool(self):
        assert TYPE_CASTERS["bool"]("true") is True
        assert TYPE_CASTERS["bool"]("False") is False

    def test_date(self):
        from datetime import date

        assert TYPE_CASTERS["date"]("20240115") == date(2024, 1, 15)

    def test_default_empty_is_str(self):
        assert TYPE_CASTERS[""]("hello") == "hello"


class TestCreateTempatedParser:
    def test_static_values(self):
        parser = create_templated_parser({"type": "phone", "country": "CN"})
        result = parser({})
        assert result == {"type": "phone", "country": "CN"}

    def test_dynamic_int(self):
        parser = create_templated_parser({"value": "{val:int}"})
        result = parser({"val": "123"})
        assert result["value"] == 123

    def test_dynamic_str(self):
        parser = create_templated_parser({"name": "{n:str}"})
        result = parser({"n": "hello"})
        assert result["name"] == "hello"

    def test_missing_group_raises(self):
        parser = create_templated_parser({"value": "{val:int}"})
        with pytest.raises(KeyError):
            parser({})

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="未找到"):
            create_templated_parser({"value": "{val:unknown}"})


class TestExpressionPattern:
    def test_create(self):
        p = ExpressionPattern(name="email", regex=re.compile(r".*"), parser_func=lambda x: x)
        assert p.name == "email"


class TestExpressionRegistry:
    def test_register_and_find_match(self):
        reg = ExpressionRegistry()
        p = ExpressionPattern(name="digits", regex=re.compile(r"^\d+$"), parser_func=lambda x: x)
        reg.register(p)
        result = reg.find_match("12345")
        assert result is not None
        assert result[0].name == "digits"

    def test_find_match_none(self):
        reg = ExpressionRegistry()
        p = ExpressionPattern(name="digits", regex=re.compile(r"^\d+$"), parser_func=lambda x: x)
        reg.register(p)
        assert reg.find_match("abc") is None

    def test_find_match_strips_whitespace(self):
        reg = ExpressionRegistry()
        p = ExpressionPattern(name="digits", regex=re.compile(r"^\d+$"), parser_func=lambda x: x)
        reg.register(p)
        result = reg.find_match("  123  ")
        assert result is not None


class TestLoadPatternsFromConfig:
    def test_empty_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            reg = load_patterns_from_config(tmpdir)
            assert len(reg._patterns) == 0

    def test_missing_dir(self):
        reg = load_patterns_from_config("/nonexistent/path")
        assert len(reg._patterns) == 0

    def test_load_valid_pattern(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "phone.yaml"), "w", encoding="utf-8") as f:
                f.write("name: phone_cn\nregex: '^\\\\d+$'\n")
            reg = load_patterns_from_config(tmpdir)
            assert len(reg._patterns) == 1
            assert reg._patterns[0].name == "phone_cn"

    def test_skip_missing_name(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "bad.yaml"), "w", encoding="utf-8") as f:
                f.write("regex: '.*'\n")
            reg = load_patterns_from_config(tmpdir)
            assert len(reg._patterns) == 0

    def test_skip_missing_regex(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "bad.yaml"), "w", encoding="utf-8") as f:
                f.write("name: test\n")
            reg = load_patterns_from_config(tmpdir)
            assert len(reg._patterns) == 0

    def test_skip_invalid_yaml(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "bad.yaml"), "w", encoding="utf-8") as f:
                f.write("invalid: [")
            reg = load_patterns_from_config(tmpdir)
            assert len(reg._patterns) == 0
