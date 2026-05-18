"""
@fileoverview ObjectParser 单元测试

覆盖 parse、can_parse、_find_deepest_arrays 的未覆盖分支。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import json

import pytest

from app.shared.core.data_source.loaders.strategies.object_parser import ObjectParser


class TestObjectParserParse:
    def test_empty(self):
        parser = ObjectParser()
        assert parser.parse("") == []
        assert parser.parse("   ") == []

    def test_invalid_json(self):
        parser = ObjectParser()
        with pytest.raises(json.JSONDecodeError):
            parser.parse("{not json")

    def test_list_input(self):
        parser = ObjectParser()
        result = parser.parse("[1, 2, 3]")
        assert result == [{"value": 1}, {"value": 2}, {"value": 3}]

    def test_dict_no_array(self):
        parser = ObjectParser()
        result = parser.parse('{"a": 1}')
        assert result == [{"a": 1}]

    def test_primitive(self):
        parser = ObjectParser()
        result = parser.parse("123")
        assert result == [{"value": 123}]


class TestObjectParserCanParse:
    def test_empty(self):
        parser = ObjectParser()
        assert parser.can_parse("") is False

    def test_array(self):
        parser = ObjectParser()
        assert parser.can_parse("[1]") is False

    def test_not_json(self):
        parser = ObjectParser()
        assert parser.can_parse("hello") is False

    def test_invalid_json(self):
        parser = ObjectParser()
        assert parser.can_parse('{"a": ') is False


class TestFindDeepestArrays:
    def test_empty_list(self):
        parser = ObjectParser()
        assert parser._find_deepest_arrays([]) == []

    def test_list_with_non_dict(self):
        parser = ObjectParser()
        result = parser._find_deepest_arrays([1, 2, 3])
        assert result == [1]

    def test_dict_with_empty_list(self):
        parser = ObjectParser()
        result = parser._find_deepest_arrays({"a": []})
        assert result == []

    def test_nested_array_in_list(self):
        parser = ObjectParser()
        result = parser._find_deepest_arrays([{"a": [{"b": 1}]}])
        assert result == [{"b": 1}]

    def test_deeply_nested_dict(self):
        parser = ObjectParser()
        result = parser._find_deepest_arrays({"a": {"b": {"c": [{"d": 1}]}}})
        assert result == [{"d": 1}]
