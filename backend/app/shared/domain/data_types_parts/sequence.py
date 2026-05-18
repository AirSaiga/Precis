"""
@fileoverview 序列数据类型模块

功能概述:
- 定义序列类型 (SequenceType)
- 支持用分隔符分隔的多个值列表
- 每个元素使用指定的数据类型进行验证和解析

架构设计:
- 继承基类: 继承自 DataType 基类
- 元素验证: 使用 item_type 验证每个元素
- 分隔符: 可配置的 delimiter (默认 ";")

输入示例:
    # 整数序列，用分号分隔
    sequence = SequenceType(item_type=IntegerType(), delimiter=";")

    # 验证序列
    sequence.validate("1;2;3;4")    # (True, None)
    sequence.validate("1;abc;3")     # (False, "第2个元素验证失败")
    sequence.validate("1;;3")        # (True, None) - 空元素跳过

输出示例:
    # validate() 返回
    (True, None)    # 所有元素都有效
    (False, "序列中的第 2 个元素 'abc' 验证失败: 不是一个整数")

    # parse() 返回解析后的列表
    SequenceType(IntegerType()).parse("1;2;3")  # [1, 2, 3]
    SequenceType(StringType()).parse("a;b;c")    # ["a", "b", "c"]
"""

from __future__ import annotations

# 1. 标准库导入
from typing import Any

# 2. 项目内部导入
from app.shared.domain.data_types_parts.base import DataType


class SequenceType(DataType):
    """
    @classdesc 序列类型

    支持用分隔符分隔的多个值列表。
    每个元素使用 item_type 进行验证和解析。

    使用场景:
    - 标签列表: "tag1;tag2;tag3"
    - ID 列表: "1;2;3;4"
    - 多值字段的校验和解析
    """

    def __init__(self, item_type: DataType, delimiter: str = ";"):
        """
        @methoddesc 初始化序列类型

        参数:
            item_type: 元素的数据类型，用于验证和解析每个元素
            delimiter: 分隔符，默认 ";"
        """
        self.item_type = item_type
        self.delimiter = delimiter

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证序列字符串

        将字符串按分隔符分割，逐个验证每个元素。
        空元素会被跳过，不视为错误。

        参数:
            value: 要验证的序列字符串

        返回:
            元组 (is_valid, error_message)
        """
        if not isinstance(value, str):
            return False, f"期望是字符串，但得到了 {type(value).__name__}。"
        if not value.strip():
            return True, None
        parts = value.split(self.delimiter)
        for i, part in enumerate(parts):
            part = part.strip()
            if not part:
                continue
            is_valid, error_message = self.item_type.validate(part)
            if not is_valid:
                return False, f"序列中的第 {i + 1} 个元素 '{part}' 验证失败: {error_message}"
        return True, None

    def parse(self, value: Any) -> list:
        """
        @methoddesc 解析序列字符串

        将字符串按分隔符分割，逐个解析每个元素。
        空元素会被跳过，不包含在结果中。

        参数:
            value: 要解析的序列字符串

        返回:
            解析后的元素列表
        """
        if not isinstance(value, str) or not value.strip():
            return []
        parsed_list = []
        parts = value.split(self.delimiter)
        for part in parts:
            part = part.strip()
            if part:
                parsed_list.append(self.item_type.parse(part))
        return parsed_list
