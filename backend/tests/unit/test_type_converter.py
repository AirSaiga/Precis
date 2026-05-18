"""
@fileoverview TypeConverter 单元测试

测试 data_source/loaders/converter.py 的类型转换功能。
"""

import os
import sys

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
        assert result[0]["b"] == 2.5
        assert result[0]["c"] is True
        assert result[0]["d"] == "4"

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
