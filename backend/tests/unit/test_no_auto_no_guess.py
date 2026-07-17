"""@fileoverview D8: 取消 JSON auto 模式 + array 收紧,全链路零启发式

验证:JSON 主数据数组的位置由顶层结构无歧义决定或用户精确指定,
任何"取最长/取第一个数组"的猜测一律消除。
"""

from __future__ import annotations

import pytest

from app.shared.core.data_source.loaders.strategies import get_parser
from app.shared.core.data_source.loaders.strategies.array_parser import ArrayParseError, ArrayParser


class TestArrayParserRejectsNestedObject:
    """D8: array 格式收紧——嵌套对象(含内嵌数组)应报错,而非猜测取第一个数组。"""

    def test_nested_object_with_dict_list_raises(self):
        """{"data": [{...}]} 用 array 格式应报错,引导用户改用 object+json_path。

        原行为:_parse_dict 取第一个列表值(猜测主数据)。现应明确拒绝。
        """
        p = ArrayParser()
        with pytest.raises(ArrayParseError, match="嵌套对象|object|json_path"):
            p.parse('{"data": [{"a": 1}, {"a": 2}]}')

    def test_nested_object_with_scalar_list_raises(self):
        """{"nums": [1,2,3]} 用 array 格式也应报错(不再包装成 key/value)。"""
        p = ArrayParser()
        with pytest.raises(ArrayParseError, match="嵌套对象|object|json_path"):
            p.parse('{"nums": [1, 2, 3]}')

    def test_can_parse_rejects_nested_object(self):
        """can_parse 对嵌套对象(含列表值)应返回 False(不再当作 array 格式)。"""
        p = ArrayParser()
        assert p.can_parse('{"data": [{"a": 1}]}') is False

    def test_top_level_array_still_works(self):
        """回归保护:顶层数组 [{...}] 仍正常解析(array 的本职场景)。"""
        p = ArrayParser()
        assert p.can_parse('[{"a": 1}]') is True
        assert p.parse('[{"a": 1}, {"a": 2}]') == [{"a": 1}, {"a": 2}]

    def test_plain_dict_without_list_still_works(self):
        """回归保护:无内嵌数组的单条 dict {"a":1} 仍返回 [data](无歧义)。"""
        p = ArrayParser()
        assert p.can_parse('{"a": 1}') is True
        assert p.parse('{"a": 1}') == [{"a": 1}]


class TestGetParserRejectsAuto:
    """D8: get_parser("auto") 应报错引导,而非走 AutoDetectParser 猜测。"""

    def test_auto_raises_deprecated_error(self):
        """format=auto 已废弃,get_parser 应抛错引导用户改用 array/lines/object。"""
        with pytest.raises((ValueError, KeyError), match="auto|废弃|array|lines|object"):
            get_parser("auto")

    def test_explicit_formats_still_work(self):
        """回归保护:array/lines/object 三种显式 format 仍正常返回 parser。"""
        from app.shared.core.data_source.loaders.strategies.array_parser import ArrayParser
        from app.shared.core.data_source.loaders.strategies.lines_parser import LinesParser
        from app.shared.core.data_source.loaders.strategies.object_parser import ObjectParser

        assert isinstance(get_parser("array"), ArrayParser)
        assert isinstance(get_parser("lines"), LinesParser)
        assert isinstance(get_parser("object"), ObjectParser)
