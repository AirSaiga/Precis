"""
@fileoverview JSON 数据类型模块

功能概述:
- 定义 JSON 专用数据类型 (JsonObject, JsonArray, JsonNull)
- 支持 JSON 对象、数组和空值的验证和解析

架构设计:
- 继承基类: 所有类型继承自 DataType 基类
- validate: 验证值是否符合 JSON 类型要求
- parse: 将值转换为 Python 原生对象

输入示例:
    # JsonObjectType 验证
    JsonObjectType().validate({"key": "value"})    # (True, None)
    JsonObjectType().validate('{"key": "value"}')  # (True, None)
    JsonObjectType().validate([1, 2, 3])           # (False, "不是 JSON 对象")

    # JsonArrayType 验证
    JsonArrayType().validate([1, 2, 3])            # (True, None)
    JsonArrayType().validate('[1, 2, 3]')          # (True, None)
    JsonArrayType().validate({"key": "value"})     # (False, "不是 JSON 数组")

    # JsonNullType 验证
    JsonNullType().validate(None)                   # (True, None)
    JsonNullType().validate(float('nan'))           # (True, None)
    JsonNullType().validate("null")                 # (True, None)
    JsonNullType().validate(0)                      # (False, "不是 null")

输出示例:
    # validate() 返回 (is_valid: bool, error_message: str | None)
    (True, None)           # 验证通过
    (False, "错误信息")     # 验证失败

    # parse() 返回转换后的值
    JsonObjectType().parse('{"key": "value"}')  # {"key": "value"} (dict)
    JsonArrayType().parse('[1, 2, 3]')          # [1, 2, 3] (list)
    JsonNullType().parse(None)                   # None
"""

from __future__ import annotations

import json
from typing import Any

import pandas as pd

from app.shared.domain.data_types_parts.base import DataType


class JsonObjectType(DataType):
    """
    @classdesc JSON 对象类型

    验证和解析 JSON 对象值。
    支持 Python dict 原生对象和 JSON 字符串格式。

    使用场景:
    - JSON 数据中的嵌套对象字段
    - 需要保留结构信息的复杂数据
    """

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为 JSON 对象

        接受以下格式:
        1. Python dict 原生对象
        2. JSON 格式字符串（解析后为 dict）

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        if value is None:
            return False, "值不能为空。"

        # 已经是 dict，直接通过
        if isinstance(value, dict):
            return True, None

        # 尝试解析 JSON 字符串
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    return True, None
            except (json.JSONDecodeError, ValueError):
                pass

        return False, f"'{value}' 不是一个有效的 JSON 对象。"

    def parse(self, value: Any) -> Any:
        """
        @methoddesc 将值转换为 Python dict

        参数:
            value: 要转换的值（dict 或 JSON 字符串）

        返回:
            Python dict 对象
        """
        if isinstance(value, dict):
            return value
        return json.loads(value)


class JsonArrayType(DataType):
    """
    @classdesc JSON 数组类型

    验证和解析 JSON 数组值。
    支持 Python list 原生对象和 JSON 字符串格式。

    使用场景:
    - JSON 数据中的数组字段
    - 需要保留列表结构的数据
    """

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为 JSON 数组

        接受以下格式:
        1. Python list 原生对象
        2. JSON 格式字符串（解析后为 list）

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        if value is None:
            return False, "值不能为空。"

        # 已经是 list，直接通过
        if isinstance(value, list):
            return True, None

        # 尝试解析 JSON 字符串
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return True, None
            except (json.JSONDecodeError, ValueError):
                pass

        return False, f"'{value}' 不是一个有效的 JSON 数组。"

    def parse(self, value: Any) -> Any:
        """
        @methoddesc 将值转换为 Python list

        参数:
            value: 要转换的值（list 或 JSON 字符串）

        返回:
            Python list 对象
        """
        if isinstance(value, list):
            return value
        return json.loads(value)


class JsonNullType(DataType):
    """
    @classdesc JSON 空值类型

    验证和解析 JSON null 值。
    支持 Python None、NaN 和字符串 "null"。

    使用场景:
    - JSON 数据中的 null 字段
    - 标记为空值的列
    """

    def validate(self, value: Any) -> tuple[bool, Any]:
        """
        @methoddesc 验证值是否为 JSON null

        接受以下格式:
        1. Python None
        2. pandas NaN (float('nan'))
        3. 字符串 "null" 或 "None" 或空字符串

        参数:
            value: 要验证的值

        返回:
            元组 (is_valid, error_message)
        """
        # None 和 NaN 都是有效的 null
        if value is None:
            return True, None

        if isinstance(value, float) and pd.isna(value):
            return True, None

        # 字符串形式的 null
        if isinstance(value, str) and value.lower() in ("null", "none", ""):
            return True, None

        return False, f"'{value}' 不是 null 值。"

    def parse(self, value: Any) -> Any:
        """
        @methoddesc 将值转换为 None

        参数:
            value: 要转换的值

        返回:
            None
        """
        return None
