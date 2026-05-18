"""
@fileoverview 复合数据类型模块

功能概述:
- 定义复合数据类型 (如复合条件)
- 支持逻辑组合 (AND/OR) 的条件表达式

架构设计:
- 继承基类: 继承自 DataType 基类
- 条件解析: 使用正则表达式分割复合条件
- 注册表匹配: 使用 registry 匹配子条件

输入示例:
    # 复合条件表达式
    value = "age > 18 AND status = 'active'"

    # logical_op = "and" 时，使用 " AND " 分割
    # logical_op = "or" 时，使用 " OR " 分割

输出示例:
    # validate() 返回
    (True, None)    # 所有子条件都有效
    (False, "复合条件中的子句 'xxx' 不匹配任何已知的模式。")

    # parse() 返回解析后的条件列表
    [
        {"field": "age", "operator": ">", "value": 18},
        {"field": "status", "operator": "=", "value": "active"}
    ]
"""

from __future__ import annotations

# 1. 标准库导入
import re
from typing import Any

# 2. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType


class CompositeConditionType(DataType):
    """
    @classdesc 复合条件类型

    支持逻辑组合（AND/OR）的条件表达式类型。
    将复合条件字符串按逻辑运算符分割为原子条件，逐个验证。

    使用场景:
    - 验证包含多个子条件的复合条件表达式
    - 如 "age > 18 AND status = 'active'"
    """

    def __init__(self, registry, logical_op: str = "and"):
        """
        @methoddesc 初始化复合条件类型

        参数:
            registry: 表达式注册表，用于匹配原子条件
            logical_op: 逻辑运算符，"and" 或 "or"
        """
        self.registry = registry
        self.splitter = re.compile(r"\s+" + re.escape(logical_op) + r"\s+")

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证复合条件表达式

        将表达式按逻辑运算符分割为原子条件，逐个使用注册表匹配验证。

        参数:
            value: 条件表达式字符串

        返回:
            元组 (is_valid, error_message)
        """
        if not isinstance(value, str):
            return False, f"期望是字符串, 但得到了 {type(value).__name__}。"
        if not value.strip():
            return True, None
        atomic_conditions = self.splitter.split(value)
        for i, atomic_str in enumerate(atomic_conditions):
            atomic_str = atomic_str.strip()
            if not atomic_str:
                return False, f"在第 {i} 个 '{self.splitter.pattern}' 分割符附近发现了空的条件表达式。"
            match_result = self.registry.find_match(atomic_str)
            if not match_result:
                return False, f"复合条件中的子句 '{atomic_str}' 不匹配任何已知的模式。"
            pattern, match = match_result
            try:
                pattern.parser_func(match.groupdict())
            except (ValueError, KeyError) as e:
                return False, f"子句 '{atomic_str}' 验证失败: {e}"
        return True, None

    def parse(self, value: Any) -> list[dict[str, Any]]:
        """
        @methoddesc 解析复合条件表达式

        将表达式按逻辑运算符分割为原子条件，逐个解析为结构化数据。

        参数:
            value: 条件表达式字符串

        返回:
            解析后的条件列表，每个元素是包含 type 和 value 的字典
        """
        if not isinstance(value, str) or not value.strip():
            return []
        parsed_conditions = []
        atomic_conditions = self.splitter.split(value)
        for atomic_str in atomic_conditions:
            atomic_str = atomic_str.strip()
            if not atomic_str:
                continue
            pattern, match = self.registry.find_match(atomic_str)
            parsed_value = pattern.parser_func(match.groupdict())
            parsed_conditions.append({"type": pattern.name, "value": parsed_value})
        return parsed_conditions


class SpecificCompositeConditionType(DataType):
    """
    @classdesc 特定复合条件类型

    针对单一模式的精确复合条件类型。
    初始化时指定具体模式名称，验证时仅匹配该模式。

    使用场景:
    - 需要限制复合条件中只能使用特定模式时
    """

    def __init__(self, registry, pattern: str, logical_op: str = "and"):
        """
        @methoddesc 初始化特定复合条件类型

        参数:
            registry: 表达式注册表
            pattern: 指定的模式名称
            logical_op: 逻辑运算符，"and" 或 "or"

        抛出:
            ValueError: 当注册表中未找到指定模式时抛出
        """
        self.registry = registry
        self.pattern_name = pattern
        self.specific_pattern = None
        for p in registry._patterns:
            if p.name == pattern:
                self.specific_pattern = p
                break
        if self.specific_pattern is None:
            raise ValueError(f"在注册表中未找到指定的模式: '{pattern}'")
        self.splitter = re.compile(r"\s+" + re.escape(logical_op) + r"\s+")

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证特定复合条件表达式

        参数:
            value: 条件表达式字符串

        返回:
            元组 (is_valid, error_message)
        """
        if not isinstance(value, str):
            return False, f"期望是字符串, 但得到了 {type(value).__name__}。"
        if not value.strip():
            return True, None
        atomic_conditions = self.splitter.split(value)
        for i, atomic_str in enumerate(atomic_conditions):
            atomic_str = atomic_str.strip()
            if not atomic_str:
                return False, f"在第 {i} 个 '{self.splitter.pattern}' 分割符附近发现了空的条件表达式。"
            match_result = self.registry.find_match(atomic_str)
            if not match_result:
                return False, f"复合条件中的子句 '{atomic_str}' 不匹配任何已知的模式。"
            pattern, match = match_result
            try:
                pattern.parser_func(match.groupdict())
            except (ValueError, KeyError) as e:
                return False, f"子句 '{atomic_str}' 验证失败: {e}"
        return True, None

    def parse(self, value: Any) -> list[dict[str, Any]]:
        """
        @methoddesc 解析特定复合条件表达式

        参数:
            value: 条件表达式字符串

        返回:
            解析后的条件列表，每个元素是包含 type 和 value 的字典
        """
        if not isinstance(value, str) or not value.strip():
            return []
        parsed_conditions = []
        atomic_conditions = self.splitter.split(value)
        for atomic_str in atomic_conditions:
            atomic_str = atomic_str.strip()
            if not atomic_str:
                continue
            pattern, match = self.registry.find_match(atomic_str)
            parsed_value = pattern.parser_func(match.groupdict())
            parsed_conditions.append({"type": pattern.name, "value": parsed_value})
        return parsed_conditions
