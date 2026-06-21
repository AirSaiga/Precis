r"""
@fileoverview 表达式数据类型模块

功能概述:
- 定义 ExpressionType 支持从注册表匹配和验证表达式格式
- 定义 SpecificExpressionType 针对单一模式的精确匹配
- 提供 validate() 和 parse() 方法用于表达式校验与解析

架构设计:
- 继承基类: 继承自 DataType 基类，遵循统一的数据类型接口
- 注册表驱动: 使用 ExpressionRegistry 匹配表达式模式
- 解析委托: 将具体解析逻辑委托给 pattern.parser_func

输入示例:
    # 注册表中的表达式模式
    registry = ExpressionRegistry(patterns=[
        Pattern(name="add", pattern=r"add\({a},{b}\)", parser_func=...)
    ])

    # 验证表达式
    ExpressionType(registry).validate("add(1,2)")    # (True, None)
    ExpressionType(registry).validate("unknown(1,2)") # (False, "不匹配任何已注册的表达式格式")

输出示例:
    # validate() 返回
    (True, None)   # 表达式有效
    (False, "表达式 'xxx' 格式正确但内容无效: ...")  # 表达式格式错

    # parse() 返回
    {
        "type": "add",
        "value": {"a": 1, "b": 2}
    }
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any

# 2. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType
from app.shared.domain.expression_system import ExpressionPattern


class ExpressionType(DataType):
    """
    @classdesc 表达式类型

    支持从注册表匹配和验证表达式格式的数据类型。
    使用 ExpressionRegistry 查找匹配的表达式模式，常用于验证手机号、邮箱等格式。

    使用场景:
    - 验证数据是否符合预定义的表达式模式
    - 将符合模式的字符串解析为结构化数据
    """

    name = "Expr"

    def __init__(self, registry):
        """
        @methoddesc 初始化表达式类型

        参数:
            registry: 表达式注册表，包含所有可用的表达式模式
        """
        self.registry = registry

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证表达式字符串

        在注册表中查找匹配的模式，并调用模式的解析函数验证内容。

        参数:
            value: 要验证的字符串

        返回:
            元组 (is_valid, error_message)
        """
        if not isinstance(value, str):
            return False, f"期望是字符串, 但得到了 {type(value).__name__}。"
        match_result = self.registry.find_match(value)
        if not match_result:
            return False, f"'{value}' 不匹配任何已注册的表达式格式。"
        pattern, match = match_result
        try:
            pattern.parser_func(match.groupdict())
            return True, None
        except (ValueError, KeyError) as e:
            return False, f"表达式 '{value}' 格式正确但内容无效: {e}"

    def parse(self, value: Any) -> dict[str, Any]:
        """
        @methoddesc 解析表达式字符串

        在注册表中查找匹配的模式，并调用解析函数生成结构化数据。

        参数:
            value: 要解析的字符串

        返回:
            包含 type 和 value 的字典
        """
        pattern, match = self.registry.find_match(value)
        return {"type": pattern.name, "value": pattern.parser_func(match.groupdict())}


class SpecificExpressionType(DataType):
    """
    @classdesc 特定表达式类型

    针对单一模式的精确表达式类型。
    初始化时指定具体模式名称，验证时仅匹配该模式。

    使用场景:
    - 需要限制列只能使用特定表达式模式时
    """

    def __init__(self, registry, pattern: str):
        """
        @methoddesc 初始化特定表达式类型

        参数:
            registry: 表达式注册表
            pattern: 指定的模式名称

        抛出:
            ValueError: 当注册表中未找到指定模式时抛出
        """
        self.registry = registry
        self.pattern_name = pattern
        specific_pattern: ExpressionPattern | None = None
        for p in registry._patterns:
            if p.name == pattern:
                specific_pattern = p
                break
        if specific_pattern is None:
            raise ValueError(f"在注册表中未找到指定的模式: '{pattern}'")
        if isinstance(specific_pattern.regex, str):
            import re

            specific_pattern.regex = re.compile(specific_pattern.regex)
        self.specific_pattern = specific_pattern

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证特定表达式字符串

        使用指定的模式进行精确匹配。

        参数:
            value: 要验证的字符串

        返回:
            元组 (is_valid, error_message)
        """
        if not isinstance(value, str):
            return False, f"期望是字符串, 但得到了 {type(value).__name__}。"
        match = self.specific_pattern.regex.fullmatch(value.strip())
        if not match:
            return False, f"'{value}' 不匹配指定的表达式格式 '{self.pattern_name}'。"
        try:
            self.specific_pattern.parser_func(match.groupdict())
            return True, None
        except (ValueError, KeyError) as e:
            return False, f"表达式 '{value}' 格式正确但内容无效: {e}"

    def parse(self, value: Any) -> dict[str, Any]:
        """
        @methoddesc 解析特定表达式字符串

        使用指定的模式进行精确匹配并解析。

        参数:
            value: 要解析的字符串

        返回:
            包含 type 和 value 的字典
        """
        match = self.specific_pattern.regex.fullmatch(value.strip())
        if not match:
            return {"type": self.specific_pattern.name, "value": None}
        return {"type": self.specific_pattern.name, "value": self.specific_pattern.parser_func(match.groupdict())}
