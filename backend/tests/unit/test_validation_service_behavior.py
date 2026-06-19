"""
@fileoverview 统一校验服务行为测试

覆盖 UnifiedValidationService 对常见约束类型的真实校验结果。
"""

from __future__ import annotations

import pandas as pd

from app.shared.services.validation.service import UnifiedValidationService


class TestNotNullValidator:
    """NotNull 约束校验行为"""

    def test_detects_null_values(self):
        df = pd.DataFrame({"col": ["a", None, "c"]})
        validator = UnifiedValidationService.get_validator("not_null")
        result = validator.validate(df, "col")
        assert result.is_valid is False
        assert result.error_count == 1

    def test_passes_when_all_present(self):
        df = pd.DataFrame({"col": ["a", "b", "c"]})
        validator = UnifiedValidationService.get_validator("not_null")
        result = validator.validate(df, "col")
        assert result.is_valid is True
        assert result.error_count == 0


class TestUniqueValidator:
    """Unique 约束校验行为"""

    def test_detects_duplicates(self):
        df = pd.DataFrame({"col": ["a", "b", "a"]})
        validator = UnifiedValidationService.get_validator("unique")
        result = validator.validate(df, "col")
        assert result.is_valid is False
        assert result.error_count >= 1

    def test_passes_when_all_unique(self):
        df = pd.DataFrame({"col": ["a", "b", "c"]})
        validator = UnifiedValidationService.get_validator("unique")
        result = validator.validate(df, "col")
        assert result.is_valid is True
        assert result.error_count == 0


class TestAllowedValuesValidator:
    """AllowedValues 约束校验行为"""

    def test_rejects_invalid_values(self):
        df = pd.DataFrame({"col": ["x", "y", "z"]})
        validator = UnifiedValidationService.get_validator("allowed_values")
        result = validator.validate(df, "col", allowed_values=["a", "b"])
        assert result.is_valid is False
        assert result.error_count == 3

    def test_accepts_valid_values(self):
        df = pd.DataFrame({"col": ["a", "b", "a"]})
        validator = UnifiedValidationService.get_validator("allowed_values")
        result = validator.validate(df, "col", allowed_values=["a", "b"])
        assert result.is_valid is True
        assert result.error_count == 0


class TestRangeValidator:
    """Range 约束校验行为"""

    def test_rejects_out_of_range(self):
        df = pd.DataFrame({"col": [1, 5, 15]})
        validator = UnifiedValidationService.get_validator("range")
        result = validator.validate(df, "col", min_value=0, max_value=10)
        assert result.is_valid is False
        assert result.error_count == 1

    def test_accepts_in_range(self):
        df = pd.DataFrame({"col": [1, 5, 9]})
        validator = UnifiedValidationService.get_validator("range")
        result = validator.validate(df, "col", min_value=0, max_value=10)
        assert result.is_valid is True


class TestRegexValidator:
    """Regex 约束校验行为"""

    def test_rejects_non_matching(self):
        df = pd.DataFrame({"col": ["123", "abc", "456"]})
        validator = UnifiedValidationService.get_validator("regex")
        result = validator.validate(df, "col", regex_pattern=r"^\d+$")
        assert result.is_valid is False
        assert result.error_count == 1


class TestUnknownValidator:
    """未知校验类型应抛出清晰异常"""

    def test_get_unknown_validator_returns_none(self):
        assert UnifiedValidationService.get_validator("nonexistent_type") is None
