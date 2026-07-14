"""
@fileoverview 校验类型定义模块单元测试

测试 ValidationType 常量和 ValidationResult 数据类。
"""

from app.shared.services.validation.types import ValidationResult, ValidationType


class TestValidationType:
    def test_regex_constant(self):
        assert ValidationType.REGEX == "regex"

    def test_unique_constant(self):
        assert ValidationType.UNIQUE == "unique"

    def test_not_null_constant(self):
        assert ValidationType.NOT_NULL == "not_null"

    def test_allowed_values_constant(self):
        assert ValidationType.ALLOWED_VALUES == "allowed_values"

    def test_range_constant(self):
        assert ValidationType.RANGE == "range"

    def test_foreign_key_constant(self):
        assert ValidationType.FOREIGN_KEY == "foreign_key"

    def test_conditional_constant(self):
        assert ValidationType.CONDITIONAL == "conditional"

    def test_scripted_constant(self):
        assert ValidationType.SCRIPTED == "scripted"

    def test_charset_constant(self):
        assert ValidationType.CHARSET == "charset"

    def test_date_logic_constant(self):
        assert ValidationType.DATE_LOGIC == "date_logic"


class TestValidationResult:
    def test_pass_result(self):
        result = ValidationResult(
            is_valid=True, error_count=0, total_rows=100, match_count=100, error_rows=[], validation_time="0.023s"
        )
        assert result.is_valid is True
        assert result.error_count == 0
        assert result.total_rows == 100
        assert result.match_count == 100
        assert result.error_rows == []
        assert result.validation_time == "0.023s"

    def test_fail_result(self):
        errors = [{"row_index": 5, "cell_value": "bad", "error_message": "invalid"}]
        result = ValidationResult(
            is_valid=False, error_count=1, total_rows=50, error_rows=errors, validation_time="0.015s"
        )
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.total_rows == 50
        assert result.error_rows == errors

    def test_default_match_count(self):
        result = ValidationResult(is_valid=True, error_count=0, total_rows=10)
        assert result.match_count is None

    def test_default_error_rows(self):
        result = ValidationResult(is_valid=True, error_count=0, total_rows=10)
        assert result.error_rows == []

    def test_default_validation_time(self):
        result = ValidationResult(is_valid=True, error_count=0, total_rows=10)
        assert result.validation_time == "0.000s"
