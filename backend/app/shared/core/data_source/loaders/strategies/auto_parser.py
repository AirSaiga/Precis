"""
@fileoverview AutoDetectParser 自动检测解析器

功能概述:
- 实现 JSON 格式自动检测和解析
- 组合多个解析器实现智能选择
- 支持标准 JSON 数组、JSON Lines 和嵌套对象格式

架构设计:
- 实现 JSONParserStrategy Protocol 接口
- 使用 ParserStrategyRegistry 管理子解析器
- 按优先级自动选择最优解析器

输入示例:
    '[{"a": 1}, {"a": 2}]'        # 标准数组格式
    '{"a": 1}\n{"a": 2}'            # JSON Lines 格式
    '{"data": [{"a": 1}]}'          # 嵌套对象格式

输出示例:
    [
        {"a": 1},
        {"a": 2}
    ]
"""

from __future__ import annotations

import json
from typing import Any

from .lines_parser import LinesParser, StandardJSONParser


class AutoDetectParser:
    """
    @classdesc JSON 格式自动检测解析器

    ============================================================================
    功能说明
    ============================================================================
    智能检测 JSON 内容格式并自动选择最优解析器。
    支持的格式优先级：
    1. JSON Lines（多行，每行独立 JSON 对象）
    2. 标准 JSON 数组（单行完整 JSON 数组）
    3. 嵌套对象（需要递归查找数据）

    ============================================================================
    业务场景
    ============================================================================
    - 源数据格式不确定时
    - 同一系统处理多种 JSON 格式
    - 快速原型开发和测试

    ============================================================================
    使用示例
    ============================================================================
    >>> parser = AutoDetectParser()
    >>>
    >>> # JSON Lines 格式
    >>> content = '{"a": 1}\\n{"a": 2}\\n{"a": 3}'
    >>> result = parser.parse(content)
    >>> # [{'a': 1}, {'a': 2}, {'a': 3}]
    >>>
    >>> # 标准数组格式
    >>> content = '[{"a": 1}, {"a": 2}]'
    >>> result = parser.parse(content)
    >>> # [{'a': 1}, {'a': 2}]
    """

    def __init__(self):
        """初始化自动检测解析器，注册所有支持的子解析器"""
        self._lines_parser = LinesParser()
        self._array_parser = StandardJSONParser()

    def parse(self, content: str) -> list[dict]:
        """
        @methoddesc 自动检测并解析 JSON 内容

        ============================================================================
        检测优先级
        ============================================================================
        1. JSON Lines 格式（高优先级）
           - 特征：多行、每行是独立 JSON 对象
           - 解析器：LinesParser

        2. 标准 JSON 数组（中优先级）
           - 特征：以 '[' 开头和结尾
           - 解析器：StandardJSONParser

        3. 嵌套对象（低优先级）
           - 特征：单行、以 '{' 开头
           - 处理：递归查找最深层的数组

        Args:
            content: JSON 内容字符串

        Returns:
            解析后的字典列表

        Raises:
            json.JSONDecodeError: JSON 格式错误
            ValueError: 无法识别格式
        """
        if not content or not content.strip():
            return []

        stripped_content = content.strip()

        if self._lines_parser.can_parse(stripped_content):
            return self._lines_parser.parse(stripped_content)

        if self._array_parser.can_parse(stripped_content):
            return self._array_parser.parse(stripped_content)

        return self._parse_nested_object(stripped_content)

    def can_parse(self, content: str) -> bool:
        """
        @methoddesc 检测内容是否为有效的 JSON 格式

        Args:
            content: 待检测的内容

        Returns:
            是否为有效的 JSON 格式
        """
        if not content or not content.strip():
            return False

        stripped_content = content.strip()

        return (
            self._lines_parser.can_parse(stripped_content)
            or self._array_parser.can_parse(stripped_content)
            or self._is_nested_object(stripped_content)
        )

    def _is_nested_object(self, content: str) -> bool:
        """
        @methoddesc 检测是否为嵌套对象格式

        Args:
            content: JSON 内容

        Returns:
            是否为嵌套对象格式
        """
        if not content.startswith("{") or not content.endswith("}"):
            return False

        try:
            parsed = json.loads(content)
            return isinstance(parsed, dict)
        except (json.JSONDecodeError, ValueError):
            return False

    def _parse_nested_object(self, content: str) -> list[dict]:
        """
        @methoddesc 解析嵌套对象格式

        递归查找最深层的数组作为数据源。

        Args:
            content: JSON 内容

        Returns:
            解析后的字典列表

        Raises:
            json.JSONDecodeError: JSON 解析错误
        """
        data = json.loads(content)

        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]

        arrays = self._find_arrays_recursive(data)
        if arrays:
            best_array = max(arrays, key=len)
            return best_array if isinstance(best_array, list) else [best_array]

        return [data] if isinstance(data, dict) else []

    def _find_arrays_recursive(self, obj: Any, depth: int = 0, max_depth: int = 10) -> list[Any]:
        """
        @methoddesc 递归查找所有数组

        Args:
            obj: 当前对象
            depth: 当前递归深度
            max_depth: 最大递归深度，防止无限递归

        Returns:
            找到的所有数组列表
        """
        if depth > max_depth:
            return []

        arrays: list[Any] = []

        if isinstance(obj, dict):
            for value in obj.values():
                if isinstance(value, list):
                    arrays.append(value)
                    # 递归检查 list 内部的 dict/list 属性（B18）
                    for item in value:
                        if isinstance(item, (dict, list)):
                            arrays.extend(self._find_arrays_recursive(item, depth + 1, max_depth))
                elif isinstance(value, (dict, list)):
                    arrays.extend(self._find_arrays_recursive(value, depth + 1, max_depth))

        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, list):
                    arrays.append(item)
                    # 递归检查嵌套 list 内部
                    for inner in item:
                        if isinstance(inner, (dict, list)):
                            arrays.extend(self._find_arrays_recursive(inner, depth + 1, max_depth))
                elif isinstance(item, dict):
                    arrays.extend(self._find_arrays_recursive(item, depth + 1, max_depth))

        return arrays
