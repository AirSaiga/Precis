"""
@fileoverview JSON 解析策略剩余分支单元测试

覆盖 AutoDetectParser、LinesParser、StandardJSONParser、ParserStrategyRegistry 的未覆盖分支。
"""

from app.shared.core.data_source.loaders.strategies.auto_parser import AutoDetectParser
from app.shared.core.data_source.loaders.strategies.lines_parser import (
    LinesParser,
    ParserStrategyRegistry,
    StandardJSONParser,
)


class TestLinesParserCanParse:
    def test_empty_content(self):
        parser = LinesParser()
        assert parser.can_parse("") is False

    def test_single_line(self):
        parser = LinesParser()
        assert parser.can_parse('{"a": 1}') is False

    def test_non_dict_line(self):
        parser = LinesParser()
        assert parser.can_parse("1\n2\n") is False

    def test_invalid_json_line(self):
        parser = LinesParser()
        assert parser.can_parse('{"a":\n{"b": 2}\n') is False


class TestStandardJSONParserCanParse:
    def test_empty(self):
        parser = StandardJSONParser()
        assert parser.can_parse("") is False

    def test_whitespace_only(self):
        parser = StandardJSONParser()
        assert parser.can_parse("   \n  ") is False

    def test_multiline_dict(self):
        parser = StandardJSONParser()
        assert parser.can_parse('{\n  "a": 1\n}') is False

    def test_invalid_json(self):
        parser = StandardJSONParser()
        assert parser.can_parse('{"a": ') is False


class TestAutoDetectParserCanParse:
    def test_not_braces(self):
        parser = AutoDetectParser()
        assert parser.can_parse("hello") is False

    def test_invalid_json(self):
        parser = AutoDetectParser()
        assert parser.can_parse('{"a": ') is False


class TestAutoDetectParserFindArrays:
    def test_max_depth(self):
        parser = AutoDetectParser()
        # Create deeply nested structure
        data = {}
        current = data
        for _ in range(15):
            current["child"] = {}
            current = current["child"]
        result = parser._find_arrays_recursive(data)
        assert result == []

    def test_list_of_lists(self):
        parser = AutoDetectParser()
        result = parser._find_arrays_recursive([[1, 2], [3, 4]])
        assert result == [[1, 2], [3, 4]]

    def test_list_of_dicts(self):
        parser = AutoDetectParser()
        result = parser._find_arrays_recursive([{"a": 1}, {"b": 2}])
        assert result == []


class TestParserStrategyRegistry:
    def test_get_parser_none(self):
        registry = ParserStrategyRegistry()
        assert registry.get_parser('{"a": 1}\n{"b": 2}') is None

    def test_parse_none(self):
        registry = ParserStrategyRegistry()
        assert registry.parse('{"a": 1}\n{"b": 2}') is None

    def test_register_and_parse(self):
        registry = ParserStrategyRegistry()
        registry.register(LinesParser(), priority=10)
        registry.register(StandardJSONParser(), priority=5)
        result = registry.parse('[{"a": 1}]')
        assert result == [{"a": 1}]
