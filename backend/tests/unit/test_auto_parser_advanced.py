"""
@fileoverview AutoDetectParser 高级单元测试

测试 _find_arrays_recursive、_parse_nested_object 等未覆盖路径。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.data_source.loaders.strategies.auto_parser import AutoDetectParser


class TestParseNestedObject:
    def test_deeply_nested_object(self):
        parser = AutoDetectParser()
        content = '{"a": {"b": {"c": [{"x": 1}, {"x": 2}]}}}'
        result = parser._parse_nested_object(content)
        assert result == [{"x": 1}, {"x": 2}]

    def test_no_array_fallback(self):
        parser = AutoDetectParser()
        content = '{"a": {"b": 1}}'
        result = parser._parse_nested_object(content)
        assert result == [{"a": {"b": 1}}]

    def test_top_level_list(self):
        parser = AutoDetectParser()
        content = '[{"a": 1}]'
        result = parser._parse_nested_object(content)
        assert result == [{"a": 1}]


class TestFindArraysRecursive:
    def test_multiple_arrays(self):
        parser = AutoDetectParser()
        data = {
            "small": [{"a": 1}],
            "large": [{"b": 1}, {"b": 2}, {"b": 3}],
        }
        arrays = parser._find_arrays_recursive(data)
        assert len(arrays) == 2
        assert max(arrays, key=len) == [{"b": 1}, {"b": 2}, {"b": 3}]

    def test_nested_arrays(self):
        parser = AutoDetectParser()
        data = {"level1": {"level2": [{"c": 1}]}}
        arrays = parser._find_arrays_recursive(data)
        assert arrays == [[{"c": 1}]]

    def test_non_dict_input(self):
        parser = AutoDetectParser()
        assert parser._find_arrays_recursive("string") == []
        assert parser._find_arrays_recursive(123) == []


class TestAutoDetectParseEdgeCases:
    def test_empty_content(self):
        parser = AutoDetectParser()
        assert parser.parse("") == []
        assert parser.parse("   ") == []

    def test_whitespace_then_array(self):
        parser = AutoDetectParser()
        content = '  \n  [{"a": 1}]  '
        result = parser.parse(content)
        assert result == [{"a": 1}]
