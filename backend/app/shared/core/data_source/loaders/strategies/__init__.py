"""
@fileoverview JSON 解析策略模块入口

功能概述:
- 聚合和导出所有 JSON 解析策略类
- 提供 get_parser 工厂函数按格式获取解析器
- 支持 auto、array、lines、object 四种解析格式
- 统一管理解析策略的公共接口

架构设计:
- 策略模式：各解析器实现 JSONParserStrategy 协议
- 工厂模式：get_parser 按格式字符串返回对应解析器实例
- 与 JSONLoader 配合使用，实现 JSON 数据的自动解析

输入示例:
    >>> from app.shared.core.data_source.loaders.strategies import get_parser
    >>> parser = get_parser("auto")      # 自动检测
    >>> parser = get_parser("array")     # 数组格式
    >>> parser = get_parser("lines")     # JSON Lines 格式
    >>> parser = get_parser("object")    # 嵌套对象格式

输出示例:
    >>> parser = get_parser("array")
    >>> data = parser.parse('[{"id": 1}, {"id": 2}]')
    >>> # 返回 [{"id": 1}, {"id": 2}]
"""

from __future__ import annotations

from .array_parser import ArrayParser
from .auto_parser import AutoDetectParser
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
    "AutoDetectParser",
]


def get_parser(format: str = "auto"):
    """
    @methoddesc 获取指定格式的解析器

    Args:
        format: JSON 格式类型
            - "auto": 自动检测（使用 AutoDetectParser）
            - "array": 标准数组格式（使用 ArrayParser）
            - "lines": JSON Lines 格式（使用 LinesParser）
            - "object": 嵌套对象格式（使用 ObjectParser）

    Returns:
        JSON 解析器实例
    """
    parsers = {
        "auto": AutoDetectParser,
        "array": ArrayParser,
        "lines": LinesParser,
        "object": ObjectParser,
    }

    parser_class = parsers.get(format)
    if not parser_class:
        raise ValueError(f"不支持的 JSON 格式: {format}，支持的格式: {list(parsers.keys())}")

    return parser_class()
