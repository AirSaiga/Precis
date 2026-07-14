"""
校验服务单元测试

测试覆盖:
- ValidationType 常量定义
- ValidationResult 数据类初始化与默认值
- UnifiedValidationService 注册、路由、执行
- BaseValidator._format_errors 静态方法
"""

from unittest.mock import MagicMock

import pandas as pd
import pytest

from app.shared.services.validation.service import UnifiedValidationService
from app.shared.services.validation.types import ValidationResult, ValidationType
from app.shared.services.validation.validators.base import BaseValidator

# ============================================================================
# ValidationType
# ============================================================================


class TestValidationType:
    def test_all_constants_defined(self):
        """所有校验类型常量已定义"""
        assert ValidationType.REGEX == "regex"
        assert ValidationType.UNIQUE == "unique"
        assert ValidationType.NOT_NULL == "not_null"
        assert ValidationType.ALLOWED_VALUES == "allowed_values"
        assert ValidationType.RANGE == "range"
        assert ValidationType.FOREIGN_KEY == "foreign_key"
        assert ValidationType.CONDITIONAL == "conditional"
        assert ValidationType.SCRIPTED == "scripted"
        assert ValidationType.CHARSET == "charset"
        assert ValidationType.DATE_LOGIC == "date_logic"


# ============================================================================
# ValidationResult
# ============================================================================


class TestValidationResult:
    def test_basic_creation(self):
        """基本构造与默认值"""
        r = ValidationResult(is_valid=True, error_count=0, total_rows=100)
        assert r.is_valid is True
        assert r.error_count == 0
        assert r.total_rows == 100
        assert r.error_rows == []
        assert r.validation_time == "0.000s"
        assert r.match_count is None

    def test_with_errors(self):
        """包含错误详情的构造"""
        errors = [{"row_index": 1, "cell_value": "bad", "error_message": "invalid"}]
        r = ValidationResult(
            is_valid=False,
            error_count=1,
            total_rows=10,
            match_count=9,
            error_rows=errors,
            validation_time="0.123s",
        )
        assert r.is_valid is False
        assert r.match_count == 9
        assert len(r.error_rows) == 1
        assert r.validation_time == "0.123s"

    def test_default_error_rows_is_empty_list(self):
        """未传入 error_rows 时默认为空列表"""
        r = ValidationResult(is_valid=True, error_count=0, total_rows=5)
        assert r.error_rows == []
        assert isinstance(r.error_rows, list)

    def test_zero_total_rows(self):
        """total_rows 为 0 的情况"""
        r = ValidationResult(is_valid=True, error_count=0, total_rows=0)
        assert r.total_rows == 0


# ============================================================================
# UnifiedValidationService
# ============================================================================


class TestUnifiedValidationService:
    @pytest.fixture(autouse=True)
    def _cleanup_registry(self):
        """每个测试后清理 mock 注册的校验器，避免污染全局状态"""
        original = dict(UnifiedValidationService._validators)
        yield
        UnifiedValidationService._validators.clear()
        UnifiedValidationService._validators.update(original)

    def test_register_and_get_validator(self):
        """注册与获取校验器"""
        mock_validator = MagicMock(spec=BaseValidator)
        UnifiedValidationService.register_validator("mock_type", mock_validator)
        assert UnifiedValidationService.get_validator("mock_type") is mock_validator

    def test_get_validator_none_for_unknown(self):
        """获取不存在的校验器返回 None"""
        assert UnifiedValidationService.get_validator("nonexistent_xyz") is None

    def test_validate_unsupported_type(self):
        """不支持的校验类型返回错误结果"""
        df = pd.DataFrame({"a": [1, 2, 3]})
        result = UnifiedValidationService.validate("unsupported_xyz", df, "a")
        assert isinstance(result, ValidationResult)
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.total_rows == 3
        assert any("不支持" in str(err.get("error_message", "")) for err in result.error_rows)

    def test_validate_with_mock_validator(self):
        """校验请求正确路由到对应校验器"""
        mock_validator = MagicMock(spec=BaseValidator)
        mock_result = ValidationResult(is_valid=True, error_count=0, total_rows=3)
        mock_validator.validate_with_error_handling.return_value = mock_result

        UnifiedValidationService.register_validator("mock_route", mock_validator)
        df = pd.DataFrame({"col": [1, 2, 3]})
        result = UnifiedValidationService.validate("mock_route", df, "col", extra_arg=123)

        mock_validator.validate_with_error_handling.assert_called_once_with(df, "col", extra_arg=123)
        assert result.is_valid is True

    def test_validate_with_real_not_null(self):
        """使用真实 NotNullValidator 执行校验"""
        df = pd.DataFrame({"name": ["a", None, "c"]})
        result = UnifiedValidationService.validate("not_null", df, "name")
        assert isinstance(result, ValidationResult)
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.total_rows == 3

    def test_validate_with_real_allowed_values(self):
        """使用真实 AllowedValuesValidator 执行校验"""
        df = pd.DataFrame({"status": ["active", "inactive", "unknown"]})
        result = UnifiedValidationService.validate(
            "allowed_values", df, "status", allowed_values=["active", "inactive"]
        )
        assert isinstance(result, ValidationResult)
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.error_rows[0]["cell_value"] == "unknown"

    def test_validate_with_real_range(self):
        """使用真实 RangeValidator 执行校验"""
        df = pd.DataFrame({"age": [10, 50, 200]})
        result = UnifiedValidationService.validate("range", df, "age", min_value=0, max_value=120)
        assert isinstance(result, ValidationResult)
        assert result.is_valid is False
        assert result.error_count == 1

    def test_validate_with_real_unique(self):
        """使用真实 UniqueValidator 执行校验"""
        df = pd.DataFrame({"id": [1, 2, 1]})
        result = UnifiedValidationService.validate("unique", df, "id")
        assert isinstance(result, ValidationResult)
        assert result.is_valid is False
        # 两个重复行都会被报告
        assert result.error_count == 2


# ============================================================================
# BaseValidator._format_errors
# ============================================================================


class TestBaseValidatorFormatErrors:
    def test_format_empty_errors(self):
        """无错误时返回通过结果"""
        result = BaseValidator._format_errors([], 10, 0.05)
        assert result.is_valid is True
        assert result.error_count == 0
        assert result.match_count == 10
        assert result.validation_time == "0.050s"

    def test_format_with_various_values(self):
        """错误值格式化: 浮点数、字符串索引、None 值"""
        errors = [
            {"row_index": 0, "value": "bad", "message": "wrong"},
            {"row_index": "3", "cell_value": 1.0, "error_message": "float"},
            {"row_index": None, "value": 1.5, "message": "decimal"},
        ]
        result = BaseValidator._format_errors(errors, 5, 0.1)
        assert result.is_valid is False
        assert result.error_count == 3
        assert result.match_count == 2
        # 字符串值保留
        assert result.error_rows[0]["cell_value"] == "bad"
        # 1.0 -> int
        assert result.error_rows[1]["cell_value"] == 1
        # "3" -> int
        assert result.error_rows[1]["row_index"] == 3
        # None -> 0
        assert result.error_rows[2]["row_index"] == 0
        # 1.5 保留
        assert result.error_rows[2]["cell_value"] == 1.5

    def test_format_float_integer(self):
        """整数形式的浮点数转为 int"""
        errors = [{"row_index": 0, "value": 42.0, "message": "big"}]
        result = BaseValidator._format_errors(errors, 1, 0.01)
        assert result.error_rows[0]["cell_value"] == 42
        assert isinstance(result.error_rows[0]["cell_value"], int)

    def test_format_float_rounding(self):
        """小数保留 6 位"""
        errors = [{"row_index": 0, "value": 1.23456789, "message": "precise"}]
        result = BaseValidator._format_errors(errors, 1, 0.01)
        assert result.error_rows[0]["cell_value"] == round(1.23456789, 6)

    def test_format_invalid_row_index(self):
        """无效 row_index 默认转为 0"""
        errors = [{"row_index": "abc", "value": "x", "message": "err"}]
        result = BaseValidator._format_errors(errors, 1, 0.01)
        assert result.error_rows[0]["row_index"] == 0

    def test_format_compatibility_fields(self):
        """兼容 value/cell_value 和 message/error_message"""
        errors = [
            {"value": "v1", "message": "m1"},
            {"cell_value": "v2", "error_message": "m2"},
        ]
        result = BaseValidator._format_errors(errors, 2, 0.01)
        assert result.error_rows[0]["cell_value"] == "v1"
        assert result.error_rows[0]["error_message"] == "m1"
        assert result.error_rows[1]["cell_value"] == "v2"
        assert result.error_rows[1]["error_message"] == "m2"
