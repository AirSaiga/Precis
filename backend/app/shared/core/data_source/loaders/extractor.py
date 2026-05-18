"""
@fileoverview JSONPathExtractor 数据提取器

功能概述:
- 实现 JSONPath 表达式的数据提取
- 支持 $.key, $.key.subkey, $..key 递归查找等语法
- 提取嵌套 JSON 数据中的特定路径

架构设计:
- 独立的提取器类，职责单一
- 支持自定义错误处理
- 可扩展的路径解析器

输入示例:
    data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
    path = "$.users"

输出示例:
    [{"name": "Alice"}, {"name": "Bob"}]
"""

from __future__ import annotations

from typing import Any


class JSONPathExtractor:
    """
    @classdesc JSONPath 数据提取器

    ============================================================================
    功能说明
    ============================================================================
    实现简单的 JSONPath 表达式解析和数据提取。
    支持常用的 JSONPath 语法，适用于大多数数据提取场景。

    ============================================================================
    支持的语法
    ============================================================================
    - $.key - 访问对象属性
    - $.key.subkey - 嵌套属性访问
    - $..key - 递归查找（返回所有匹配的值）
    - $.key[*] - 数组全部元素
    - $.key[0] - 数组指定索引
    - $ - 根节点

    ============================================================================
    业务场景
    ============================================================================
    - 从嵌套 JSON 中提取数据
    - 处理 API 返回的复杂 JSON 结构
    - 数据清洗和转换

    ============================================================================
    使用示例
    ============================================================================
    >>> extractor = JSONPathExtractor()
    >>>
    >>> # 基本提取
    >>> data = {"users": [{"name": "Alice"}, {"name": "Bob"}]}
    >>> result = extractor.extract(data, "$.users")
    >>> # [{"name": "Alice"}, {"name": "Bob"}]
    >>>
    >>> # 递归查找
    >>> data = {"a": {"b": {"c": 1}}, "d": 2}
    >>> result = extractor.extract(data, "$..c")
    >>> # [1]
    """

    def __init__(self):
        """
        @methoddesc 初始化 JSONPath 提取器

        创建提取器实例，无需额外参数。
        """
        pass

    def extract(self, data: Any, jsonpath: str) -> list[dict]:
        """
        @methoddesc 从 JSON 数据中提取指定路径的数据

        ============================================================================
        处理逻辑
        ============================================================================
        1. 规范化路径（移除 $ 前缀）
        2. 根据路径类型选择提取策略
           - 递归查找 (..key): 使用深度优先搜索
           - 普通路径 (key.subkey): 逐层解析
        3. 展平结果（如果是嵌套列表）

        Args:
            data: JSON 数据（字典或列表）
            jsonpath: JSONPath 表达式

        Returns:
            提取后的数据列表

        Raises:
            ValueError: 路径不存在或格式错误
        """
        if not jsonpath or jsonpath == "$":
            return data if isinstance(data, list) else [data]

        normalized_path = self._normalize_path(jsonpath)

        if normalized_path.startswith(".."):
            return self._extract_recursive(data, normalized_path[2:])

        return self._extract_by_path(data, normalized_path)

    def _normalize_path(self, path: str) -> str:
        """
        @methoddesc 规范化 JSONPath

        移除 $ 前缀，统一路径格式。

        Args:
            path: 原始路径

        Returns:
            规范化后的路径
        """
        if path.startswith("$."):
            return path[2:]
        elif path.startswith("$"):
            return path[1:]
        return path

    def _extract_by_path(self, data: Any, path: str) -> list[dict]:
        """
        @methoddesc 根据路径提取数据

        Args:
            data: JSON 数据
            path: 路径（不含 $ 前缀）

        Returns:
            提取后的数据列表
        """
        current = data
        parts = self._parse_path(path)

        for part in parts:
            current = self._navigate_step(current, part)

            if current is None:
                return []

        if isinstance(current, list):
            return current
        else:
            return [current] if current is not None else []

    def _parse_path(self, path: str) -> list[str | int]:
        """
        @methoddesc 解析路径为组成部分

        Args:
            path: 路径字符串

        Returns:
            路径部分列表（字符串或整数）
        """
        parts: list[str | int] = []
        current = ""
        i = 0

        while i < len(path):
            char = path[i]

            if char == ".":
                if current:
                    parts.append(current)
                    current = ""
            elif char == "[":
                if current:
                    parts.append(current)
                    current = ""
                end = path.find("]", i)
                if end != -1:
                    key = path[i + 1 : end].strip("\"'")
                    try:
                        parts.append(int(key))
                    except ValueError:
                        parts.append(key)
                    i = end
            else:
                current += char

            i += 1

        if current:
            parts.append(current)

        return parts

    def _navigate_step(self, data: Any, step: str | int) -> Any:
        """
        @methoddesc 单步导航

        根据当前数据类型（字典或列表）和路径步骤，
        导航到下一层数据。

        Args:
            data: 当前数据
            step: 路径部分（字符串键或整数索引）

        Returns:
            下一步的数据
        """
        if isinstance(data, dict):
            return data.get(step)
        elif isinstance(data, list):
            if isinstance(step, int):
                if 0 <= step < len(data):
                    return data[step]
                return None
            elif step == "*":
                return data
            return None
        return None

    def _extract_recursive(self, data: Any, key: str) -> list[Any]:
        """
        @methoddesc 递归查找指定键的所有值

        Args:
            data: JSON 数据
            key: 要查找的键名

        Returns:
            所有匹配的值列表
        """
        results: list[Any] = []

        def search(obj: Any) -> None:
            """
            @methoddesc 递归搜索对象中的目标键值

            参数:
                obj: 当前搜索的对象（字典或列表）
            """
            if isinstance(obj, dict):
                if key in obj:
                    results.append(obj[key])
                for value in obj.values():
                    search(value)
            elif isinstance(obj, list):
                for item in obj:
                    search(item)

        search(data)
        return results

    def _is_recursive_path(self, path: str) -> bool:
        """
        @methoddesc 判断是否为递归路径

        Args:
            path: 路径字符串

        Returns:
            是否为递归路径（以 .. 开头）
        """
        return path.startswith("..")
