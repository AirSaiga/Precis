"""
@fileoverview TypeConverter 单元测试

测试 data_source/loaders/converter.py 的类型转换功能。
"""

import os
import sys
from datetime import date, datetime
from decimal import Decimal

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


from app.shared.core.data_source.loaders.converter import TypeConverter


class TestTypeConverter:
    def test_convert_empty_records(self):
        c = TypeConverter()
        assert c.convert([], {"id": "int"}) == []

    def test_convert_empty_dtype(self):
        c = TypeConverter()
        records = [{"id": "1"}]
        assert c.convert(records, {}) == records

    def test_convert_int(self):
        c = TypeConverter()
        records = [{"id": "1"}, {"id": "42"}]
        result = c.convert(records, {"id": "int"})
        assert result[0]["id"] == 1
        assert result[1]["id"] == 42

    def test_convert_int_invalid_fallback(self):
        c = TypeConverter()
        records = [{"id": "2.5"}]
        result = c.convert(records, {"id": "int"})
        # int("2.5") raises ValueError, fallback returns original value
        assert result[0]["id"] == "2.5"

    def test_convert_float(self):
        c = TypeConverter()
        records = [{"amount": "12.5"}, {"amount": 10}]
        result = c.convert(records, {"amount": "float"})
        assert result[0]["amount"] == 12.5
        assert result[1]["amount"] == 10.0

    def test_convert_bool(self):
        c = TypeConverter()
        records = [
            {"active": "true"},
            {"active": "false"},
            {"active": "1"},
            {"active": "0"},
            {"active": "yes"},
            {"active": "no"},
            {"active": True},
            {"active": False},
            {"active": 1},
            {"active": 0},
        ]
        result = c.convert(records, {"active": "bool"})
        assert result[0]["active"] is True
        assert result[1]["active"] is False
        assert result[2]["active"] is True
        assert result[3]["active"] is False
        assert result[4]["active"] is True
        assert result[5]["active"] is False
        assert result[6]["active"] is True
        assert result[7]["active"] is False
        assert result[8]["active"] is True
        assert result[9]["active"] is False

    def test_convert_str(self):
        c = TypeConverter()
        records = [{"name": 123}, {"name": True}]
        result = c.convert(records, {"name": "string"})
        assert result[0]["name"] == "123"
        assert result[1]["name"] == "True"

    def test_convert_none_preserved(self):
        c = TypeConverter()
        records = [{"id": None}]
        result = c.convert(records, {"id": "int"})
        assert result[0]["id"] is None

    def test_convert_missing_column(self):
        c = TypeConverter()
        records = [{"name": "Alice"}]
        result = c.convert(records, {"id": "int"})
        assert result[0] == {"name": "Alice"}

    def test_convert_unsupported_type(self):
        c = TypeConverter()
        records = [{"val": "x"}]
        result = c.convert(records, {"val": "unknown_type"})
        assert result[0]["val"] == "x"

    def test_convert_alias_types(self):
        c = TypeConverter()
        records = [{"a": "1", "b": "2.5", "c": "true", "d": 4}]
        result = c.convert(records, {"a": "integer", "b": "decimal", "c": "boolean", "d": "str"})
        assert result[0]["a"] == 1
        # decimal 不再降级为 float，使用高精度 Decimal
        assert result[0]["b"] == Decimal("2.5")
        assert result[0]["c"] is True
        assert result[0]["d"] == "4"

    def test_convert_decimal_precision(self):
        """decimal 类型应保留高精度，避免 float 二进制误差。"""
        c = TypeConverter()
        # 0.1 + 0.2 在 float 下 != 0.3，Decimal 下精确
        records = [{"amount": "0.1"}, {"amount": "19.99"}, {"amount": 1}]
        result = c.convert(records, {"amount": "decimal"})
        assert result[0]["amount"] == Decimal("0.1")
        assert result[1]["amount"] == Decimal("19.99")
        # int -> Decimal 通过 str 中转，避免 Decimal(1) 的浮点误差路径
        assert result[2]["amount"] == Decimal("1")
        # 关键：Decimal 类型保持精度，不会变成 float
        assert isinstance(result[0]["amount"], Decimal)
        assert isinstance(result[1]["amount"], Decimal)

    def test_convert_decimal_invalid_fallback(self):
        """非法 decimal 值应回退原值，不抛异常。"""
        c = TypeConverter()
        records = [{"amount": "abc"}]
        result = c.convert(records, {"amount": "decimal"})
        assert result[0]["amount"] == "abc"

    def test_convert_decimal_preserves_existing_decimal(self):
        """已是 Decimal 的值应原样保留。"""
        c = TypeConverter()
        records = [{"amount": Decimal("123.456")}]
        result = c.convert(records, {"amount": "decimal"})
        assert result[0]["amount"] == Decimal("123.456")
        assert isinstance(result[0]["amount"], Decimal)

    def test_convert_date(self):
        c = TypeConverter()
        records = [{"d": "2026-07-07"}]
        result = c.convert(records, {"d": "date"})
        assert result[0]["d"] == date(2026, 7, 7)

    def test_convert_datetime_aliases(self):
        """datetime / timestamp 别名都应解析为 datetime。"""
        c = TypeConverter()
        records = [{"t": "2026-07-07T15:30:00"}]
        result = c.convert(records, {"t": "datetime"})
        assert result[0]["t"] == datetime(2026, 7, 7, 15, 30, 0)

        records2 = [{"t": "2026-07-07T15:30:00"}]
        result2 = c.convert(records2, {"t": "timestamp"})
        assert result2[0]["t"] == datetime(2026, 7, 7, 15, 30, 0)

    def test_convert_date_invalid_fallback(self):
        """非法日期字符串应回退原值。"""
        c = TypeConverter()
        records = [{"d": "not-a-date"}]
        result = c.convert(records, {"d": "date"})
        assert result[0]["d"] == "not-a-date"

    def test_convert_date_from_datetime_object(self):
        """datetime 对象转 date 时应取日期分量。"""
        c = TypeConverter()
        records = [{"d": datetime(2026, 7, 7, 15, 30, 0)}]
        result = c.convert(records, {"d": "date"})
        assert result[0]["d"] == date(2026, 7, 7)

    def test_convert_single(self):
        c = TypeConverter()
        assert c.convert_single("123", "int") == 123
        assert c.convert_single("12.5", "float") == 12.5
        assert c.convert_single("true", "bool") is True
        assert c.convert_single(None, "int") is None

    def test_to_int_from_float(self):
        c = TypeConverter()
        assert c._to_int(3.7) == 3

    def test_to_float_from_int(self):
        c = TypeConverter()
        assert c._to_float(5) == 5.0

    def test_to_bool_from_string_on_off(self):
        c = TypeConverter()
        assert c._to_bool("on") is True
        assert c._to_bool("off") is False

    def test_to_bool_from_unsupported(self):
        c = TypeConverter()
        assert c._to_bool([1, 2]) is True
        assert c._to_bool([]) is False
