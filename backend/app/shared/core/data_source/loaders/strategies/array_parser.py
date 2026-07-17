"""
@fileoverview ArrayParser JSON 数组解析策略

功能概述:
- 解析标准 JSON 数组格式: [{"a": 1}, {"a": 2}]
- 解析单个对象包装格式: {"a": 1}
- 自动检测输入数据是否为数组格式
- 处理 json.JSONDecodeError 异常

架构设计:
- 实现 JSONParserStrategy Protocol 协议
- 策略模式用于支持多种 JSON 解析方式
- 可与 JSONLoader 配合使用

输入示例:
    # 标准数组格式
    '[{"a": 1}, {"a": 2}]'
    # 单个对象格式
    '{"a": 1}'
    # 嵌套数组格式
    '{"data": [{"a": 1}, {"a": 2}]}'

输出示例:
    [{"a": 1}, {"a": 2}]  # 返回字典列表
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class JSONParserStrategy(Protocol):
    """
    @classdesc JSON 解析策略协议

    定义 JSON 解析器的标准接口。
    实现此协议的具体策略类可以处理不同格式的 JSON 数据。
    """

    def can_parse(self, raw_content: str) -> bool:
        """
        @methoddesc 检测是否能够解析给定的原始内容

        Args:
            raw_content: 原始 JSON 字符串

        Returns:
            如果能够解析返回 True，否则返回 False
        """
        ...

    def parse(self, raw_content: str) -> list[dict[str, Any]]:
        """
        @methoddesc 解析 JSON 字符串为字典列表

        Args:
            raw_content: 原始 JSON 字符串

        Returns:
            字典列表

        Raises:
            ArrayParseError: 解析失败时抛出
        """
        ...


class ArrayParseError(Exception):
    """
    @classdesc JSON 数组解析异常

    当 JSON 数组解析失败时抛出此异常，
    携带原始错误信息以便排查问题。

    使用场景:
    - JSON 格式非法导致解析失败
    - 输入数据类型不匹配（期望数组/字典但收到其他类型）
    - JSONPath 指向的路径不存在
    """

    def __init__(self, message: str, cause: Exception | None = None):
        """
        @methoddesc 初始化解析异常

        参数:
            message: 错误描述信息
            cause: 原始异常对象（可选，用于异常链追踪）
        """
        super().__init__(message)
        self.cause = cause

    def __str__(self) -> str:
        msg = super().__str__()
        if self.cause:
            msg = f"{msg} (原因: {self.cause})"
        return msg


class ArrayParser:
    """
    @classdesc JSON 数组解析器

    专门处理 JSON 数组格式的解析器，支持：
    - 标准 JSON 数组格式: [{"a": 1}, {"a": 2}]
    - 单个对象包装格式: {"a": 1}
    - 嵌套数组提取: {"data": [{"a": 1}, {"a": 2}]}

    使用示例:
        parser = ArrayParser()

        # 解析标准数组
        result = parser.parse('[{"a": 1}, {"a": 2}]')
        # 返回: [{"a": 1}, {"a": 2}]

        # 解析单个对象
        result = parser.parse('{"a": 1}')
        # 返回: [{"a": 1}]

        # 检测是否可解析
        can_parse = parser.can_parse('[{"a": 1}]')
        # 返回: True
    """

    def can_parse(self, raw_content: str) -> bool:
        """
        @methoddesc 检测给定的原始内容是否为数组格式

        检测逻辑:
        1. 首先尝试 JSON 解析，检查解析结果是否为列表
        2. 如果是字典，检查是否包含列表类型的值
        3. 处理空白字符和常见格式错误

        Args:
            raw_content: 原始 JSON 字符串

        Returns:
            如果可以解析为数组格式返回 True，否则返回 False
        """
        if not raw_content or not isinstance(raw_content, str):
            return False

        stripped = raw_content.strip()
        if not stripped:
            return False

        try:
            parsed = json.loads(stripped)

            # 直接是列表
            if isinstance(parsed, list):
                return True

            # D8: 收紧 array 格式。仅接受"无内嵌数组的 dict"(单条记录,如 {"a":1})。
            # 含内嵌数组的嵌套对象(如 {"data":[...]})不算 array 格式——主数据数组位置
            # 有歧义,必须用 format=object + json_path 精确指定,不再猜测取第一个数组。
            if isinstance(parsed, dict):
                has_nested_list = any(isinstance(value, list) for value in parsed.values())
                return not has_nested_list

            return False

        except (json.JSONDecodeError, ValueError) as e:
            logger.debug(f"JSON 格式检测失败: {e}")
            return False

    def parse(self, raw_content: str) -> list[dict[str, Any]]:
        """
        @methoddesc 解析 JSON 字符串为字典列表

        支持的格式:
        1. 标准数组: [{"a": 1}, {"a": 2}] -> 返回原列表
        2. 单个对象: {"a": 1} -> 返回包装后的列表 [{"a": 1}]
        3. 嵌套对象: {"data": [{"a": 1}]} -> 提取内层数组

        Args:
            raw_content: 原始 JSON 字符串

        Returns:
            字典列表

        Raises:
            ArrayParseError: JSON 解析失败或格式不支持时抛出
        """
        if not raw_content or not isinstance(raw_content, str):
            raise ArrayParseError("输入为空或类型错误")

        stripped = raw_content.strip()
        if not stripped:
            raise ArrayParseError("输入内容为空")

        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as e:
            raise ArrayParseError(f"JSON 解析失败 (行 {e.lineno}, 列 {e.colno}): {e.msg}", cause=e)
        except ValueError as e:
            raise ArrayParseError(f"JSON 格式错误: {e}", cause=e)

        # 处理不同格式
        if isinstance(parsed, list):
            return self._parse_list(parsed)

        elif isinstance(parsed, dict):
            return self._parse_dict(parsed)

        else:
            raise ArrayParseError(f"不支持的 JSON 类型: {type(parsed).__name__}，期望列表或字典")

    def _parse_list(self, data: list) -> list[dict[str, Any]]:
        """
        @methoddesc 解析列表数据

        Args:
            data: 解析后的列表数据

        Returns:
            字典列表
        """
        result: list[dict[str, Any]] = []

        for item in data:
            if isinstance(item, dict):
                result.append(item)
            else:
                # 非字典类型，包装为单值对象
                result.append({"value": item})

        return result

    def _parse_dict(self, data: dict) -> list[dict[str, Any]]:
        """
        @methoddesc 解析字典数据

        D8 策略(零启发式):
        - 含内嵌数组的嵌套对象(如 {"data":[...]})→ 报错,引导改用 format=object + json_path
          精确指定数据数组路径(不再猜测取第一个数组)。
        - 无内嵌数组的单条 dict(如 {"a":1})→ 返回 [data](无歧义)。

        Args:
            data: 解析后的字典数据

        Returns:
            字典列表

        Raises:
            ArrayParseError: 字典含内嵌数组(嵌套对象)时抛出
        """
        # D8: 含内嵌数组的嵌套对象拒绝(主数据数组位置有歧义,不应猜测)
        has_nested_list = any(isinstance(value, list) for value in data.values())
        if has_nested_list:
            raise ArrayParseError(
                "array 格式仅支持顶层数组 JSON(如 [{...}])或无内嵌数组的单条对象;"
                "嵌套对象(含内嵌数组)请改用 format=object 并通过 json_path "
                "(如 $.data)精确指定数据数组路径。"
            )

        # 无内嵌数组,将字典作为单条记录
        return [data]
