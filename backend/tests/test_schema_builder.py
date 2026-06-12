"""测试 schema builder 的 build_type_from_config 工厂函数"""

import pytest

from app.shared.domain.data_types import (
    BooleanType,
    DateType,
    DecimalType,
    ExpressionType,
    ExtractedType,
    FloatType,
    IntegerType,
    SequenceType,
    StringType,
)
from app.shared.domain.schema.builder import (
    TYPE_REGISTRY,
    build_type_from_config,
)


class TestBuildTypeFromConfigString:
    def test_int(self):
        result = build_type_from_config("int")
        assert isinstance(result, IntegerType)

    def test_integer(self):
        result = build_type_from_config("integer")
        assert isinstance(result, IntegerType)

    def test_string(self):
        result = build_type_from_config("string")
        assert isinstance(result, StringType)

    def test_str(self):
        result = build_type_from_config("str")
        assert isinstance(result, StringType)

    def test_float(self):
        result = build_type_from_config("float")
        assert isinstance(result, FloatType)

    def test_decimal(self):
        result = build_type_from_config("decimal")
        assert isinstance(result, DecimalType)

    def test_boolean(self):
        result = build_type_from_config("boolean")
        assert isinstance(result, BooleanType)

    def test_bool(self):
        result = build_type_from_config("bool")
        assert isinstance(result, BooleanType)

    def test_date(self):
        result = build_type_from_config("date")
        assert isinstance(result, DateType)

    def test_int_uppercase(self):
        result = build_type_from_config("Int")
        assert isinstance(result, IntegerType)

    def test_str_uppercase(self):
        result = build_type_from_config("Str")
        assert isinstance(result, StringType)

    def test_float_uppercase(self):
        result = build_type_from_config("Float")
        assert isinstance(result, FloatType)

    def test_boolean_uppercase(self):
        result = build_type_from_config("Boolean")
        assert isinstance(result, BooleanType)

    def test_date_uppercase(self):
        result = build_type_from_config("Date")
        assert isinstance(result, DateType)

    def test_decimal_uppercase(self):
        result = build_type_from_config("Decimal")
        assert isinstance(result, DecimalType)

    def test_unknown_type_raises_value_error(self):
        with pytest.raises(ValueError, match="未知的类型名称"):
            build_type_from_config("unknown_type_xyz")


class TestBuildTypeFromConfigDict:
    def test_sequence_with_item_type_string(self):
        result = build_type_from_config({"name": "Sequence", "item_type": "string"})
        assert isinstance(result, SequenceType)

    def test_expression_type_with_registry_object(self):
        from app.shared.domain.expression_system import ExpressionRegistry

        registry = ExpressionRegistry()
        result = build_type_from_config(
            {"name": "Expr", "registry": registry},
        )
        assert isinstance(result, ExpressionType)

    def test_expression_type_with_string_registry(self):
        from app.shared.domain.expression_system import ExpressionRegistry

        registries = {"patterns": ExpressionRegistry()}
        result = build_type_from_config(
            {"name": "Expr", "registry": "patterns"},
            registries=registries,
        )
        assert isinstance(result, ExpressionType)

    def test_dict_missing_name_raises_value_error(self):
        with pytest.raises(ValueError, match="缺少或包含未知的类型名称"):
            build_type_from_config({})

    def test_dict_unknown_name_raises_value_error(self):
        with pytest.raises(ValueError, match="缺少或包含未知的类型名称"):
            build_type_from_config({"name": "UnknownType"})

    def test_string_registry_not_found_raises_value_error(self):
        with pytest.raises(ValueError, match="表达式注册中心未提供"):
            build_type_from_config(
                {"name": "Expr", "registry": "nonexistent"},
                registries={},
            )

    def test_extracted_type_with_params(self):
        result = build_type_from_config(
            {
                "name": "Extracted",
                "source_column": "col1",
                "extract_key": "key1",
            }
        )
        assert isinstance(result, ExtractedType)

    def test_sequence_with_delimiter(self):
        result = build_type_from_config(
            {
                "name": "Sequence",
                "item_type": "int",
                "delimiter": ";",
            }
        )
        assert isinstance(result, SequenceType)


class TestBuildTypeFromConfigInvalid:
    def test_none_raises_type_error(self):
        with pytest.raises(TypeError, match="无效的类型配置格式"):
            build_type_from_config(None)

    def test_list_raises_type_error(self):
        with pytest.raises(TypeError, match="无效的类型配置格式"):
            build_type_from_config([])

    def test_int_raises_type_error(self):
        with pytest.raises(TypeError, match="无效的类型配置格式"):
            build_type_from_config(42)


class TestTypeRegistryCoverage:
    def test_registry_has_all_uppercase_keys(self):
        uppercase_keys = [
            "Int",
            "Str",
            "Float",
            "Decimal",
            "Boolean",
            "Date",
            "Expr",
            "CompositeExpr",
            "Sequence",
            "Extracted",
            "JsonObject",
            "JsonArray",
            "JsonNull",
        ]
        for key in uppercase_keys:
            assert key in TYPE_REGISTRY, f"Missing uppercase key: {key}"

    def test_registry_has_all_lowercase_keys(self):
        lowercase_keys = [
            "int",
            "integer",
            "string",
            "str",
            "float",
            "decimal",
            "boolean",
            "bool",
            "date",
            "json_object",
            "json_array",
            "json_null",
        ]
        for key in lowercase_keys:
            assert key in TYPE_REGISTRY, f"Missing lowercase key: {key}"
