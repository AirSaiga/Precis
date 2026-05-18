"""
@fileoverview TypeConverter 类型转换器

功能概述:
- 实现数据类型转换功能
- 支持整数、浮点数、布尔值、字符串等类型转换
- 提供统一的类型转换接口

架构设计:
- 独立的转换器类，职责单一
- 支持批量转换和单个值转换
- 完善的错误处理

输入示例:
    records = [{"id": "1", "amount": "12.5", "active": "true"}]
    dtype = {"id": "int", "amount": "float", "active": "bool"}

输出示例:
    [{"id": 1, "amount": 12.5, "active": True}]
"""

from __future__ import annotations

from typing import Any


class TypeConverter:
    """
    @classdesc 数据类型转换器

    ============================================================================
    功能说明
    ============================================================================
    将数据记录中的指定列转换为目标类型。
    支持的类型：int, integer, float, bool, str, string

    ============================================================================
    支持的类型
    ============================================================================
    - int/integer: 整数类型
    - float/decimal: 浮点数类型
    - bool/boolean: 布尔类型
    - str/string: 字符串类型

    ============================================================================
    业务场景
    ============================================================================
    - 数据清洗和类型规范化
    - CSV/JSON 数据类型统一
    - 数据导入前的类型预处理

    ============================================================================
    使用示例
    ============================================================================
    >>> converter = TypeConverter()
    >>>
    >>> records = [
    ...     {"id": "1", "amount": "12.5", "active": "true"},
    ...     {"id": "2", "amount": "23.7", "active": "false"}
    ... ]
    >>> dtype = {"id": "int", "amount": "float", "active": "bool"}
    >>>
    >>> result = converter.convert(records, dtype)
    >>> # [{"id": 1, "amount": 12.5, "active": True},
    >>> #  {"id": 2, "amount": 23.7, "active": False}]
    """

    TYPE_MAPPING = {
        "int": "int",
        "integer": "int",
        "float": "float",
        "decimal": "float",
        "bool": "bool",
        "boolean": "bool",
        "str": "str",
        "string": "str",
    }

    def __init__(self):
        """
        @methoddesc 初始化类型转换器

        创建转换器实例，内置常见类型映射规则（int/integer、float/decimal、bool/boolean、str/string）。
        """
        pass

    def convert(self, records: list[dict], dtype: dict[str, str]) -> list[dict]:
        """
        @methoddesc 批量转换数据记录的类型

        ============================================================================
        处理逻辑
        ============================================================================
        1. 遍历每条记录
        2. 对每条记录，根据 dtype 配置转换指定列
        3. 保留原始值，如果转换失败则保留原值

        Args:
            records: 数据记录列表
            dtype: 类型配置字典，键为列名，值为目标类型

        Returns:
            转换后的数据记录列表

        示例:
            >>> records = [{"id": "1", "name": "Alice"}]
            >>> dtype = {"id": "int"}
            >>> result = converter.convert(records, dtype)
            >>> # [{"id": 1, "name": "Alice"}]
        """
        if not records or not dtype:
            return records

        result = []
        for record in records:
            converted = self._convert_record(record, dtype)
            result.append(converted)

        return result

    def _convert_record(self, record: dict, dtype: dict[str, str]) -> dict:
        """
        @methoddesc 转换单条记录

        Args:
            record: 单条数据记录
            dtype: 类型配置

        Returns:
            转换后的记录
        """
        converted = record.copy()

        for col, type_str in dtype.items():
            if col in converted:
                converted[col] = self._convert_value(converted[col], type_str)

        return converted

    def _convert_value(self, value: Any, type_str: str) -> Any:
        """
        @methoddesc 转换单个值

        Args:
            value: 要转换的值
            type_str: 目标类型字符串

        Returns:
            转换后的值（如果转换失败，返回原始值）

        Raises:
            ValueError: 不支持的类型
        """
        if value is None:
            return None

        normalized_type = self.TYPE_MAPPING.get(type_str.lower())
        if not normalized_type:
            return value

        try:
            if normalized_type == "int":
                return self._to_int(value)
            elif normalized_type == "float":
                return self._to_float(value)
            elif normalized_type == "bool":
                return self._to_bool(value)
            elif normalized_type == "str":
                return str(value)
            return value
        except (ValueError, TypeError):
            return value

    def _to_int(self, value: Any) -> int:
        """
        @methoddesc 转换为整数

        Args:
            value: 要转换的值

        Returns:
            整数
        """
        if isinstance(value, (int, float)):
            return int(value)
        return int(str(value).strip())

    def _to_float(self, value: Any) -> float:
        """
        @methoddesc 转换为浮点数

        Args:
            value: 要转换的值

        Returns:
            浮点数
        """
        if isinstance(value, (int, float)):
            return float(value)
        return float(str(value).strip())

    def _to_bool(self, value: Any) -> bool:
        """
        @methoddesc 转换为布尔值

        处理多种布尔值表示：
        - 字符串: "true", "false", "1", "0", "yes", "no"
        - 数字: 1, 0

        Args:
            value: 要转换的值

        Returns:
            布尔值
        """
        if isinstance(value, bool):
            return value

        if isinstance(value, (int, float)):
            return bool(value)

        if isinstance(value, str):
            lower = value.lower().strip()
            if lower in ("true", "1", "yes", "on"):
                return True
            if lower in ("false", "0", "no", "off"):
                return False

        return bool(value)

    def convert_single(self, value: Any, type_str: str) -> Any:
        """
        @methoddesc 转换单个值

        这是 convert 方法的单值版本，适用于单个值的类型转换。

        Args:
            value: 要转换的值
            type_str: 目标类型

        Returns:
            转换后的值

        示例:
            >>> converter.convert_single("123", "int")
            123
            >>> converter.convert_single("true", "bool")
            True
        """
        return self._convert_value(value, type_str)
