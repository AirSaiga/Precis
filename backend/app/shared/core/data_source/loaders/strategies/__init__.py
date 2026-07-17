"""
@fileoverview JSON 解析策略模块入口

功能概述:
- 聚合和导出所有 JSON 解析策略类
- 提供 get_parser 工厂函数按格式获取解析器
- 支持 array、lines、object 三种解析格式(D8: auto 已废弃)
- 统一管理解析策略的公共接口

架构设计:
- 策略模式：各解析器实现 JSONParserStrategy 协议
- 工厂模式：get_parser 按格式字符串返回对应解析器实例
- 与 JSONLoader 配合使用，实现 JSON 的显式格式解析

输入示例:
    >>> from app.shared.core.data_source.loaders.strategies import get_parser
    >>> parser = get_parser("array")     # 顶层数组格式
    >>> parser = get_parser("lines")     # JSON Lines 格式
    >>> parser = get_parser("object")    # 嵌套对象格式

输出示例:
    >>> parser = get_parser("array")
    >>> data = parser.parse('[{"id": 1}, {"id": 2}]')
    >>> # 返回 [{"id": 1}, {"id": 2}]
"""

from __future__ import annotations

from .array_parser import ArrayParser
from .lines_parser import (
    JSONParserStrategy,
    LinesParser,
    ParserStrategyRegistry,
    StandardJSONParser,
)
from .object_parser import ObjectParser

__all__ = [
    "JSONParserStrategy",
    "LinesParser",
    "StandardJSONParser",
    "ParserStrategyRegistry",
    "ArrayParser",
    "ObjectParser",
]


def get_parser(format: str):
    """
    @methoddesc 获取指定格式的解析器

    D8: format 必须显式指定(array/lines/object),不再支持 auto 自动检测。
    auto 会猜测主数据数组(取最长/取第一个),与精确列定义的设计矛盾,已废弃。

    Args:
        format: JSON 格式类型(必填)
            - "array": 顶层数组 JSON(如 [{...}])
            - "lines": JSON Lines 格式(每行一个 JSON)
            - "object": 嵌套对象格式(需配合 json_path 精确指定数据数组)

    Returns:
        JSON 解析器实例

    Raises:
        ValueError: format="auto"(已废弃)或不支持时抛出,引导用户改用显式 format
    """
    # D8: auto 已废弃,明确报错引导(不替用户猜该改成什么)
    if format == "auto":
        raise ValueError(
            "format='auto' 已废弃(自动检测会猜测主数据数组,可能导致校验跑错对象)。"
            "请显式指定 format:array(顶层数组 [{...}])、lines(JSON Lines)、"
            "或 object(嵌套对象,需配合 json_path 如 $.data 精确指定数据数组路径)。"
        )

    parsers = {
        "array": ArrayParser,
        "lines": LinesParser,
        "object": ObjectParser,
    }

    parser_class = parsers.get(format)
    if not parser_class:
        raise ValueError(f"不支持的 JSON 格式: {format}，支持的格式: {list(parsers.keys())}(auto 已废弃)")

    return parser_class()
