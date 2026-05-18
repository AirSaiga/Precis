"""
@fileoverview LinesParser 策略类

功能概述:
- 实现 JSON Lines 格式的解析器策略
- 支持逐行解析 JSON Lines 格式数据
- 自动检测 JSON Lines 格式

架构设计:
- 实现 JSONParserStrategy Protocol 接口
- 可被 ParserStrategyRegistry 注册管理
- 独立的解析策略，便于扩展和维护

输入示例:
    '{"a": 1}\n{"a": 2}\n{"b": "test"}\n'

输出示例:
    [
        {"a": 1},
        {"a": 2},
        {"b": "test"}
    ]
"""

from __future__ import annotations

import json
from typing import Protocol, runtime_checkable


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


class LinesParser:
    """
    @classdesc JSON Lines 格式解析器

    ============================================================================
    功能说明
    ============================================================================
    专门用于解析 JSON Lines 格式（又称 newline-delimited JSON）的策略类。
    JSON Lines 格式中，每一行都是一个独立的、有效的 JSON 对象，以换行符分隔。

    格式示例:
        {"name": "Alice", "age": 30}
        {"name": "Bob", "age": 25}
        {"name": "Charlie", "age": 35}

    ============================================================================
    业务场景
    ============================================================================
    - 日志文件处理：每行一条日志记录
    - 数据导入导出：适合大文件流式处理
    - 配置文件：多行配置的便捷格式
    - 增量数据同步：每次变更作为一行

    ============================================================================
    使用示例
    ============================================================================
    >>> parser = LinesParser()
    >>> content = '{"a": 1}\\n{"a": 2}\\n{"a": 3}'
    >>> result = parser.parse(content)
    >>> print(result)
    [{'a': 1}, {'a': 2}, {'a': 3}]

    >>> # 检测格式
    >>> parser.can_parse('{"key": "value"}')  # True
    >>> parser.can_parse('[1, 2, 3]')        # False
    """

    def parse(self, content: str) -> list[dict]:
        """
        @methoddesc 解析 JSON Lines 格式内容

        ============================================================================
        处理逻辑
        ============================================================================
        1. 按换行符分割内容
        2. 跳过空行和纯空白行
        3. 逐行解析为 JSON 对象
        4. 返回字典列表

        Args:
            content: JSON Lines 格式内容

        Returns:
            解析后的字典列表

        Raises:
            json.JSONDecodeError: 当某一行无法解析为有效 JSON 时抛出
                                 错误信息包含行号便于定位问题
        """
        if not content:
            return []

        records: list[dict] = []
        lines = content.split("\n")

        for line_num, line in enumerate(lines, start=1):
            stripped_line = line.strip()
            if not stripped_line:
                continue

            try:
                parsed = json.loads(stripped_line)
                # 保留非 dict 条目并包装为 {"value": ...}，避免静默丢弃数据（B19）
                if isinstance(parsed, dict):
                    records.append(parsed)
                else:
                    records.append({"value": parsed})
            except json.JSONDecodeError as e:
                raise json.JSONDecodeError(f"第 {line_num} 行 JSON 解析失败: {e.msg}", e.doc, e.pos) from e

        return records

    def can_parse(self, content: str) -> bool:
        """
        @methoddesc 检测内容是否为 JSON Lines 格式

        ============================================================================
        检测规则
        ============================================================================
        JSON Lines 格式的特征：
        1. 包含多行内容（至少一行非空行）
        2. 每行（非空行）都是独立的有效 JSON 对象
        3. 对象类型必须是字典（而非数组或原始类型）

        检测策略：
        - 采样前 N 行进行检测（默认 5 行）
        - 如果采样行中非空行都是有效的 JSON 对象字典，则认为是 JSON Lines
        - 单行 JSON 数组或普通 JSON 对象会被判定为非 JSON Lines

        Args:
            content: 待检测的内容字符串

        Returns:
            是否为 JSON Lines 格式
        """
        if not content:
            return False

        lines = content.split("\n")
        non_empty_lines = [line.strip() for line in lines if line.strip()]

        if not non_empty_lines:
            return False

        if len(non_empty_lines) == 1:
            return False

        sample_lines = non_empty_lines[:5]

        for line in sample_lines:
            try:
                parsed = json.loads(line)
                if not isinstance(parsed, dict):
                    return False
            except (json.JSONDecodeError, ValueError):
                return False

        return True


class StandardJSONParser:
    """
    @classdesc 标准 JSON 格式解析器

    ============================================================================
    功能说明
    ============================================================================
    解析标准 JSON 格式（数组形式）的策略类。
    适用于 JSON 数组格式：[{"a": 1}, {"a": 2}]

    ============================================================================
    与 LinesParser 的区别
    ============================================================================
    - LinesParser: 每行一个 JSON 对象，适合流式处理
    - StandardJSONParser: 完整的 JSON 数组，一次性解析
    """

    def parse(self, content: str) -> list[dict]:
        """
        @methoddesc 解析标准 JSON 数组格式

        Args:
            content: JSON 数组字符串

        Returns:
            解析后的字典列表

        Raises:
            json.JSONDecodeError: 解析失败时抛出
        """
        if not content:
            return []

        data = json.loads(content)

        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        elif isinstance(data, dict):
            return [data]
        else:
            raise json.JSONDecodeError(f"不支持的 JSON 根类型: {type(data).__name__}", content, 0)

    def can_parse(self, content: str) -> bool:
        """
        @methoddesc 检测是否为标准 JSON 格式

        Args:
            content: 待检测的内容

        Returns:
            是否为标准 JSON 格式
        """
        if not content:
            return False

        content = content.strip()

        if not content:
            return False

        if content.startswith("[") and content.endswith("]"):
            return True

        try:
            parsed = json.loads(content)
            return isinstance(parsed, dict) and len(content.split("\n")) <= 1
        except (json.JSONDecodeError, ValueError):
            return False


class ParserStrategyRegistry:
    """
    @classdesc 解析器策略注册表

    ============================================================================
    功能说明
    ============================================================================
    管理和注册各种 JSON 解析策略，支持自动选择最优解析器。
    按优先级顺序尝试各策略，返回第一个能成功解析的策略结果。

    ============================================================================
    使用示例
    ============================================================================
    >>> registry = ParserStrategyRegistry()
    >>> registry.register(LinesParser(), priority=10)
    >>> registry.register(StandardJSONParser(), priority=5)

    >>> content = '{"a": 1}\\n{"a": 2}'
    >>> parser = registry.get_parser(content)
    >>> result = parser.parse(content)
    """

    def __init__(self):
        """
        @methoddesc 初始化解析策略注册表

        创建空的策略列表，后续通过 register() 方法注册解析策略。
        """
        self._strategies: list[tuple[int, JSONParserStrategy]] = []

    def register(self, strategy: JSONParserStrategy, priority: int = 0) -> None:
        """
        @methoddesc 注册解析策略

        Args:
            strategy: 解析策略实例
            priority: 优先级，数值越大优先级越高
        """
        self._strategies.append((priority, strategy))
        self._strategies.sort(key=lambda x: x[0], reverse=True)

    def get_parser(self, content: str) -> JSONParserStrategy | None:
        """
        @methoddesc 获取适合内容的解析器

        Args:
            content: 待解析的内容

        Returns:
            匹配的解析器，未找到返回 None
        """
        for _, strategy in self._strategies:
            if strategy.can_parse(content):
                return strategy
        return None

    def parse(self, content: str) -> list[dict] | None:
        """
        @methoddesc 自动解析内容

        Args:
            content: 待解析的内容

        Returns:
            解析结果，解析失败返回 None
        """
        parser = self.get_parser(content)
        if parser:
            return parser.parse(content)
        return None
