"""
@fileoverview JSON 解析策略基类模块

功能概述:
- 定义 JSON 解析的策略接口（JSONParserStrategy Protocol）
- 提供统一的 parse 和 can_parse 方法契约
- 支持自动检测适合的解析策略
- 支持自定义解析策略扩展

架构设计:
- 使用 Protocol 接口定义策略契约，无需显式继承
- 各策略实现类负责具体解析逻辑
- 注册表机制管理可用策略（ParserStrategyRegistry）
- 策略模式支持多种 JSON 格式的灵活解析

输入示例:
    content = '[{"name": "Alice"}, {"name": "Bob"}]'
    # 或 content = '{"data": [{"name": "Alice"}]}'
    # 或 content = '{"name": "Alice"}\n{"name": "Bob"}'

输出示例:
    strategy.parse(content)
    # 统一返回字典列表: [{"name": "Alice"}, {"name": "Bob"}]
    # 单条对象自动包装为单元素列表
"""

from __future__ import annotations

from typing import Protocol


class JSONParserStrategy(Protocol):
    """
    @classdesc JSON 解析策略接口

    定义解析 JSON 内容的标准接口，所有具体策略必须实现此协议。

    职责:
        - 解析 JSON 格式内容
        - 检测内容是否适合当前策略

    方法说明:
        - parse: 将 JSON 字符串解析为字典列表
        - can_parse: 判断内容是否适合当前策略解析

    示例:
        class StandardJSONParser:
            def parse(self, content: str) -> List[Dict]:
                import json
                data = json.loads(content)
                if isinstance(data, list):
                    return data
                return [data]

            def can_parse(self, content: str) -> bool:
                return content.strip().startswith('[') or '"' in content
    """

    def parse(self, content: str) -> list[dict]:
        """
        @methoddesc 解析 JSON 内容

        将 JSON 字符串解析为字典列表。
        如果 JSON 根节点是单个对象，应包装为单元素列表。

        Args:
            content: JSON 格式的字符串内容

        Returns:
            解析后的字典列表

        Raises:
            json.JSONDecodeError: JSON 格式错误时抛出
            ValueError: 内容不符合策略解析条件时抛出
        """
        ...

    def can_parse(self, content: str) -> bool:
        """
        @methoddesc 判断是否可以使用当前策略解析内容

        通过检测内容特征判断是否适合当前策略。
        策略选择器会根据此方法的返回值选择合适的策略。

        Args:
            content: 待检测的字符串内容

        Returns:
            True 表示当前策略可以解析此内容，False 表示不能解析
        """
        ...
