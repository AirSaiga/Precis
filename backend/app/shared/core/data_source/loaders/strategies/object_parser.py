"""
@fileoverview ObjectParser 策略类

功能概述:
- 实现嵌套对象格式的 JSON 解析器策略
- 支持递归查找最深层的数组作为数据源
- 处理没有数组时的单条记录转换

架构设计:
- 实现 JSONParserStrategy Protocol 接口
- 可被 ParserStrategyRegistry 注册管理
- 独立的解析策略，便于扩展和维护

输入示例:
    '{"data": [{"a": 1}, {"a": 2}]}'
    '{"users": {"items": [{"id": 1}, {"id": 2}]}}'
    '{"name": "test"}'

输出示例:
    [{"a": 1}, {"a": 2}]
    [{"id": 1}, {"id": 2}]
    [{"name": "test"}]
"""

from __future__ import annotations

import json
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class JSONParserStrategy(Protocol):
    """
    @classdesc JSON 解析策略协议

    定义 JSON 解析器必须实现的接口。

    接口要求:
        - parse: 解析 JSON 内容
        - can_parse: 检测是否能解析给定内容
    """

    def parse(self, content: str) -> list[dict]:
        """
        @methoddesc 解析 JSON 内容

        Args:
            content: JSON 内容字符串

        Returns:
            解析后的字典列表

        Raises:
            JSONDecodeError: 解析失败时抛出
        """
        ...

    def can_parse(self, content: str) -> bool:
        """
        @methoddesc 检测是否能解析给定内容

        Args:
            content: 待检测的内容字符串

        Returns:
            是否能解析
        """
        ...


class ObjectParser:
    """
    @classdesc 嵌套对象格式解析器

    ============================================================================
    功能说明
    ============================================================================
    专门用于解析嵌套对象格式 JSON 的策略类。
    能够自动查找嵌套结构中最深层的数组作为数据源。
    如果没有找到数组，则将字典转换为单条记录。

    格式示例:
        - 单层嵌套: {"data": [{"a": 1}, {"a": 2}]}
        - 多层嵌套: {"users": {"items": [{"id": 1}, {"id": 2}]}}
        - 深度嵌套: {"result": {"data": {"records": [{"x": 1}]}}}
        - 单对象: {"name": "test", "value": 123}

    ============================================================================
    业务场景
    ============================================================================
    - API 响应数据：大多数 REST API 返回嵌套的 JSON 对象
    - 配置文件：包含嵌套结构的配置文件
    - 导出数据：某些工具导出的嵌套格式数据

    ============================================================================
    使用示例
    ============================================================================
    >>> parser = ObjectParser()
    >>> content = '{"data": [{"a": 1}, {"a": 2}]}'
    >>> result = parser.parse(content)
    >>> print(result)
    [{'a': 1}, {'a': 2}]

    >>> # 单对象转换为单条记录
    >>> content = '{"name": "test"}'
    >>> result = parser.parse(content)
    >>> print(result)
    [{'name': 'test'}]
    """

    def parse(self, content: str) -> list[dict]:
        """
        @methoddesc 解析嵌套对象格式的 JSON 内容

        ============================================================================
        处理逻辑
        ============================================================================
        1. 解析 JSON 字符串为 Python 对象
        2. 递归查找最深层的数组
        3. 如果找到数组，返回数组内容（每个元素转换为字典）
        4. 如果没有找到数组，将根对象包装为单元素列表
        5. 使用 pandas.json_normalize 扁平化嵌套字段

        Args:
            content: 嵌套对象格式的 JSON 内容

        Returns:
            解析后的字典列表

        Raises:
            json.JSONDecodeError: JSON 格式错误时抛出
            ValueError: 内容不符合策略解析条件时抛出
        """
        if not content or not content.strip():
            return []

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            raise json.JSONDecodeError(f"JSON 解析失败: {e.msg}", e.doc, e.pos) from e

        if isinstance(data, list):
            return [item if isinstance(item, dict) else {"value": item} for item in data]

        if isinstance(data, dict):
            arrays = self._find_deepest_arrays(data)
            if arrays:
                return arrays
            return [data]

        return [{"value": data}]

    def can_parse(self, content: str) -> bool:
        """
        @methoddesc 检测内容是否为嵌套对象格式

        ============================================================================
        检测规则
        ============================================================================
        嵌套对象格式的特征：
        1. 以花括号开头（表示 JSON 对象）
        2. 包含嵌套结构（至少一层嵌套）
        3. 可能包含数组作为某个属性的值
        4. 不是以数组直接开头的格式

        检测策略：
        - 首先尝试 JSON 解析
        - 解析成功且结果为字典（非数组）时返回 True
        - 如果以数组开头或为空则返回 False

        Args:
            content: 待检测的内容字符串

        Returns:
            是否为嵌套对象格式
        """
        if not content:
            return False

        content = content.strip()

        if content.startswith("["):
            return False

        if not content.startswith("{"):
            return False

        try:
            data = json.loads(content)
            return isinstance(data, dict)
        except (json.JSONDecodeError, ValueError):
            return False

    def _find_deepest_arrays(self, obj: Any, current_depth: int = 0) -> list[dict]:
        """
        @methoddesc 递归查找最深层的数组

        ============================================================================
        算法说明
        ============================================================================
        使用深度优先搜索（DFS）遍历对象结构：
        1. 如果当前对象是数组，记录当前位置并继续深入查找
        2. 如果数组元素是字典，继续在数组元素中查找更深的数组
        3. 返回最深层的数组作为数据源

        特殊情况处理：
        - 空数组：忽略，继续查找
        - 非字典数组元素：忽略
        - 混合类型数组：只取字典类型元素

        Args:
            obj: 当前检查的对象
            current_depth: 当前递归深度

        Returns:
            如果找到最深层的数组，返回数组内容；否则返回空列表
        """
        if isinstance(obj, list):
            if not obj:
                return []

            result = []
            for item in obj:
                if isinstance(item, dict):
                    nested = self._find_deepest_arrays(item, current_depth + 1)
                    if nested:
                        return nested
                    result.append(item)

            return result if result else obj[:1] if obj else []

        if isinstance(obj, dict):
            arrays_found: list[tuple[int, list[dict]]] = []

            for key, value in obj.items():
                if isinstance(value, list):
                    if not value:
                        continue

                    for item in value:
                        if isinstance(item, dict):
                            nested = self._find_deepest_arrays(item, current_depth + 1)
                            if nested:
                                arrays_found.append((current_depth + 2, nested))
                            else:
                                arrays_found.append((current_depth + 1, [item]))

                elif isinstance(value, dict):
                    nested = self._find_deepest_arrays(value, current_depth + 1)
                    if nested:
                        arrays_found.append((current_depth + 1, nested))

            if arrays_found:
                return max(arrays_found, key=lambda x: x[0])[1]

        return []
