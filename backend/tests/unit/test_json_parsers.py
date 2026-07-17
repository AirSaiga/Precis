"""
@fileoverview JSON 解析策略和加载器单元测试

测试 array_parser、lines_parser、object_parser、auto_parser 和 json_loader。
"""

import json

import pytest

from app.shared.core.data_source.loaders.strategies import get_parser
from app.shared.core.data_source.loaders.strategies.array_parser import ArrayParseError, ArrayParser
from app.shared.core.data_source.loaders.strategies.lines_parser import LinesParser, StandardJSONParser
from app.shared.core.data_source.loaders.strategies.object_parser import ObjectParser


class TestArrayParser:
    def test_can_parse_array(self):
        p = ArrayParser()
        assert p.can_parse('[{"a": 1}]') is True

    def test_can_parse_dict_with_list(self):
        # D8: 嵌套对象(含内嵌数组)不算 array 格式,应返回 False
        p = ArrayParser()
        assert p.can_parse('{"data": [{"a": 1}]}') is False

    def test_can_parse_plain_dict(self):
        p = ArrayParser()
        assert p.can_parse('{"a": 1}') is True

    def test_can_parse_empty(self):
        p = ArrayParser()
        assert p.can_parse("") is False
        assert p.can_parse("   ") is False
        assert p.can_parse(None) is False

    def test_can_parse_invalid_json(self):
        p = ArrayParser()
        assert p.can_parse("not json") is False

    def test_parse_array(self):
        p = ArrayParser()
        result = p.parse('[{"a": 1}, {"a": 2}]')
        assert result == [{"a": 1}, {"a": 2}]

    def test_parse_single_object(self):
        p = ArrayParser()
        result = p.parse('{"a": 1}')
        assert result == [{"a": 1}]

    def test_parse_nested_object(self):
        # D8: 嵌套对象用 array 格式应报错(不再取第一个数组),引导改用 object+json_path
        p = ArrayParser()
        with pytest.raises(ArrayParseError, match="嵌套对象|object|json_path"):
            p.parse('{"data": [{"a": 1}, {"a": 2}]}')

    def test_parse_nested_object_non_dict_list(self):
        # D8: 含标量数组的嵌套对象同样报错(不再包装成 key/value)
        p = ArrayParser()
        with pytest.raises(ArrayParseError, match="嵌套对象|object|json_path"):
            p.parse('{"nums": [1, 2, 3]}')

    def test_parse_list_with_non_dict_items(self):
        p = ArrayParser()
        result = p.parse("[1, 2, 3]")
        assert result == [{"value": 1}, {"value": 2}, {"value": 3}]

    def test_parse_empty_input(self):
        p = ArrayParser()
        with pytest.raises(ArrayParseError):
            p.parse("")
        with pytest.raises(ArrayParseError):
            p.parse(None)

    def test_parse_invalid_json(self):
        p = ArrayParser()
        with pytest.raises(ArrayParseError):
            p.parse("not json")

    def test_parse_unsupported_type(self):
        p = ArrayParser()
        with pytest.raises(ArrayParseError):
            p.parse("123")

    def test_parse_error_str(self):
        e = ArrayParseError("msg", cause=ValueError("cause"))
        assert "cause" in str(e)


class TestLinesParser:
    def test_parse_json_lines(self):
        p = LinesParser()
        content = '{"a": 1}\n{"a": 2}\n{"a": 3}'
        result = p.parse(content)
        assert result == [{"a": 1}, {"a": 2}, {"a": 3}]

    def test_parse_empty_lines(self):
        p = LinesParser()
        assert p.parse("") == []

    def test_parse_skips_empty_lines(self):
        p = LinesParser()
        content = '{"a": 1}\n\n{"a": 2}'
        result = p.parse(content)
        assert result == [{"a": 1}, {"a": 2}]

    def test_parse_invalid_line_raises(self):
        p = LinesParser()
        with pytest.raises(json.JSONDecodeError):
            p.parse('{"a": 1}\nnot json')

    def test_can_parse_json_lines(self):
        p = LinesParser()
        assert p.can_parse('{"a": 1}\n{"a": 2}') is True

    def test_can_parse_single_line_false(self):
        p = LinesParser()
        assert p.can_parse('{"a": 1}') is False

    def test_can_parse_empty_false(self):
        p = LinesParser()
        assert p.can_parse("") is False

    def test_can_parse_non_dict_line_false(self):
        p = LinesParser()
        assert p.can_parse("[1]\n[2]") is False


class TestStandardJSONParser:
    def test_parse_array(self):
        p = StandardJSONParser()
        result = p.parse('[{"a": 1}, {"a": 2}]')
        assert result == [{"a": 1}, {"a": 2}]

    def test_parse_dict(self):
        p = StandardJSONParser()
        result = p.parse('{"a": 1}')
        assert result == [{"a": 1}]

    def test_parse_empty(self):
        p = StandardJSONParser()
        assert p.parse("") == []

    def test_parse_unsupported_type(self):
        p = StandardJSONParser()
        with pytest.raises(json.JSONDecodeError):
            p.parse("123")

    def test_can_parse_array(self):
        p = StandardJSONParser()
        assert p.can_parse('[{"a": 1}]') is True

    def test_can_parse_dict_single_line(self):
        p = StandardJSONParser()
        # Single-line dict is also considered parseable by StandardJSONParser
        assert p.can_parse('{"a": 1}') is True


class TestObjectParser:
    def test_parse_nested(self):
        p = ObjectParser()
        result = p.parse('{"data": {"items": [{"a": 1}]}}')
        assert result == [{"a": 1}]

    def test_parse_single_object(self):
        p = ObjectParser()
        result = p.parse('{"name": "test"}')
        assert result == [{"name": "test"}]

    def test_parse_list(self):
        p = ObjectParser()
        result = p.parse('[{"a": 1}]')
        assert result == [{"a": 1}]

    def test_parse_empty(self):
        p = ObjectParser()
        assert p.parse("") == []

    def test_can_parse_dict(self):
        p = ObjectParser()
        assert p.can_parse('{"a": 1}') is True

    def test_can_parse_list_false(self):
        p = ObjectParser()
        assert p.can_parse('[{"a": 1}]') is False


class TestGetParser:
    def test_get_all_parsers(self):
        # D8: auto 已废弃,只支持 array/lines/object 三种显式 format
        assert isinstance(get_parser("array"), ArrayParser)
        assert isinstance(get_parser("lines"), LinesParser)
        assert isinstance(get_parser("object"), ObjectParser)

    def test_get_parser_auto_deprecated(self):
        # D8: format=auto 已废弃,应报错引导用户改用显式 format
        with pytest.raises(ValueError, match="auto|废弃|array|lines|object"):
            get_parser("auto")

    def test_get_parser_invalid(self):
        with pytest.raises(ValueError, match="不支持的 JSON 格式"):
            get_parser("invalid")
