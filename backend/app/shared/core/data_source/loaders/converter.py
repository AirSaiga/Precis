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

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


class TypeConverter:
    """
    @classdesc 数据类型转换器

    ============================================================================
    功能说明
    ============================================================================
    将数据记录中的指定列转换为目标类型。
    支持的类型：int, integer, float, decimal, bool, str, string, date, datetime

    ============================================================================
    支持的类型
    ============================================================================
    - int/integer: 整数类型
    - float: 浮点数类型（科学计算）
    - decimal: 高精度小数类型（财务计算，使用 decimal.Decimal，避免 float 精度丢失）
    - bool/boolean: 布尔类型
    - str/string: 字符串类型
    - date/datetime/timestamp: 日期/日期时间类型（datetime.date / datetime.datetime）

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
    >>> dtype = {"id": "int", "amount": "decimal", "active": "bool"}
    >>>
    >>> result = converter.convert(records, dtype)
    >>> # [{"id": 1, "amount": Decimal('12.5'), "active": True},
    >>> #  {"id": 2, "amount": Decimal('23.7'), "active": False}]
    """

    TYPE_MAPPING = {
        "int": "int",
        "integer": "int",
        "float": "float",
        "decimal": "decimal",
        "bool": "bool",
        "boolean": "bool",
        "str": "str",
        "string": "str",
        "date": "date",
        "datetime": "datetime",
        "timestamp": "datetime",
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
            elif normalized_type == "decimal":
                return self._to_decimal(value)
            elif normalized_type == "bool":
                return self._to_bool(value)
            elif normalized_type == "str":
                return str(value)
            elif normalized_type == "date":
                return self._to_date(value)
            elif normalized_type == "datetime":
                return self._to_datetime(value)
            return value
        except (ValueError, TypeError, InvalidOperation):
            # InvalidOperation 继承 ArithmeticError（非 ValueError），非法 decimal 值同样回退原值
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

    def _to_decimal(self, value: Any) -> Decimal:
        """
        @methoddesc 转换为高精度 Decimal

        用于财务数据等需要精确十进制表示的场景，避免 float 的二进制精度丢失。
        始终通过 str() 中转以避免 float -> Decimal 的二进制误差（如 Decimal(0.1) != 0.1）。

        Args:
            value: 要转换的值

        Returns:
            Decimal 对象
        """
        if isinstance(value, Decimal):
            return value
        if isinstance(value, bool):
            # bool 是 int 子类，需先转 int 再转 Decimal，避免直接 str(True)="True" 报错
            return Decimal(int(value))
        if isinstance(value, (int, float)):
            return Decimal(str(value))
        return Decimal(str(value).strip())

    def _to_date(self, value: Any) -> date:
        """
        @methoddesc 转换为日期（date，不含时间分量）

        优先解析 ISO 8601 格式（YYYY-MM-DD），失败则尝试常见替代格式。

        Args:
            value: 要转换的值

        Returns:
            datetime.date 对象
        """
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, date):
            return value
        return date.fromisoformat(str(value).strip())

    def _to_datetime(self, value: Any) -> datetime:
        """
        @methoddesc 转换为日期时间（datetime，含时间分量）

        优先解析 ISO 8601 格式，失败则尝试常见替代格式。

        Args:
            value: 要转换的值

        Returns:
            datetime.datetime 对象
        """
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return datetime(value.year, value.month, value.day)
        return datetime.fromisoformat(str(value).strip())

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
