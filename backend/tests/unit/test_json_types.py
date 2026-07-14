"""
@fileoverview JSON 数据类型测试（T48 覆盖补充）

覆盖目标:
- domain/data_types_parts/json_types.py: JsonObjectType, JsonArrayType, JsonNullType
"""

from app.shared.domain.data_types_parts.json_types import JsonArrayType, JsonNullType, JsonObjectType

# ============================================================================
# JsonObjectType 测试
# ============================================================================


class TestJsonObjectType:
    def test_validate_dict(self):
        """Python dict 应验证通过。"""
        t = JsonObjectType()
        ok, err = t.validate({"key": "value"})
        assert ok is True
        assert err is None

    def test_validate_json_string(self):
        """JSON 对象字符串应验证通过。"""
        t = JsonObjectType()
        ok, err = t.validate('{"key": "value"}')
        assert ok is True

    def test_validate_none(self):
        """None 应验证失败。"""
        t = JsonObjectType()
        ok, err = t.validate(None)
        assert ok is False

    def test_validate_list(self):
        """list 应验证失败。"""
        t = JsonObjectType()
        ok, err = t.validate([1, 2, 3])
        assert ok is False

    def test_validate_invalid_json_string(self):
        """无效 JSON 字符串应验证失败。"""
        t = JsonObjectType()
        ok, err = t.validate("not json")
        assert ok is False

    def test_validate_json_array_string(self):
        """JSON 数组字符串应验证失败（不是对象）。"""
        t = JsonObjectType()
        ok, err = t.validate("[1, 2, 3]")
        assert ok is False

    def test_parse_dict(self):
        """dict 应直接返回。"""
        t = JsonObjectType()
        d = {"key": "value"}
        assert t.parse(d) is d

    def test_parse_json_string(self):
        """JSON 字符串应解析为 dict。"""
        t = JsonObjectType()
        result = t.parse('{"key": "value"}')
        assert result == {"key": "value"}


# ============================================================================
# JsonArrayType 测试
# ============================================================================


class TestJsonArrayType:
    def test_validate_list(self):
        """Python list 应验证通过。"""
        t = JsonArrayType()
        ok, err = t.validate([1, 2, 3])
        assert ok is True

    def test_validate_json_string(self):
        """JSON 数组字符串应验证通过。"""
        t = JsonArrayType()
        ok, err = t.validate("[1, 2, 3]")
        assert ok is True

    def test_validate_none(self):
        """None 应验证失败。"""
        t = JsonArrayType()
        ok, err = t.validate(None)
        assert ok is False

    def test_validate_dict(self):
        """dict 应验证失败。"""
        t = JsonArrayType()
        ok, err = t.validate({"key": "value"})
        assert ok is False

    def test_validate_invalid_json_string(self):
        """无效 JSON 字符串应验证失败。"""
        t = JsonArrayType()
        ok, err = t.validate("not json")
        assert ok is False

    def test_validate_json_object_string(self):
        """JSON 对象字符串应验证失败（不是数组）。"""
        t = JsonArrayType()
        ok, err = t.validate('{"key": "value"}')
        assert ok is False

    def test_parse_list(self):
        """list 应直接返回。"""
        t = JsonArrayType()
        lst = [1, 2, 3]
        assert t.parse(lst) is lst

    def test_parse_json_string(self):
        """JSON 字符串应解析为 list。"""
        t = JsonArrayType()
        result = t.parse("[1, 2, 3]")
        assert result == [1, 2, 3]


# ============================================================================
# JsonNullType 测试
# ============================================================================


class TestJsonNullType:
    def test_validate_none(self):
        """None 应验证通过。"""
        t = JsonNullType()
        ok, err = t.validate(None)
        assert ok is True

    def test_validate_nan(self):
        """NaN 应验证通过。"""
        t = JsonNullType()
        ok, err = t.validate(float("nan"))
        assert ok is True

    def test_validate_null_string(self):
        """ "null" 字符串应验证通过。"""
        t = JsonNullType()
        ok, err = t.validate("null")
        assert ok is True

    def test_validate_none_string(self):
        """ "None" 字符串应验证通过。"""
        t = JsonNullType()
        ok, err = t.validate("None")
        assert ok is True

    def test_validate_empty_string(self):
        """空字符串应验证通过。"""
        t = JsonNullType()
        ok, err = t.validate("")
        assert ok is True

    def test_validate_zero(self):
        """0 应验证失败。"""
        t = JsonNullType()
        ok, err = t.validate(0)
        assert ok is False

    def test_validate_non_empty_string(self):
        """非空字符串应验证失败。"""
        t = JsonNullType()
        ok, err = t.validate("hello")
        assert ok is False

    def test_parse_returns_none(self):
        """parse 应始终返回 None。"""
        t = JsonNullType()
        assert t.parse(None) is None
        assert t.parse("null") is None
        assert t.parse(0) is None
