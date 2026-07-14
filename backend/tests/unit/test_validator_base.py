"""
@fileoverview 校验器基类单元测试

测试 BaseValidator.validate_with_error_handling 和抽象方法。
"""

import pandas as pd
import pytest

from app.shared.services.validation.types import ValidationResult
from app.shared.services.validation.validators.base import BaseValidator


class GoodValidator(BaseValidator):
    def validate(self, df, column, **kwargs):
        return ValidationResult(is_valid=True, error_count=0, total_rows=len(df))


class BadValidator(BaseValidator):
    def validate(self, df, column, **kwargs):
        raise RuntimeError("boom")


class DummyConstraint:
    def validate(self, datasets, **kwargs):
        return {
            "errors": [
                {"row_index": 1, "value": "bad", "message": "wrong"},
            ]
        }


class TestDelegateValidation:
    def test_delegate_without_formatter(self):
        v = GoodValidator()
        df = pd.DataFrame({"a": [1, 2]})
        result = v._delegate_validation(df, "a", DummyConstraint())
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.error_rows[0]["cell_value"] == "bad"
        assert result.error_rows[0]["error_message"] == "wrong"

    def test_delegate_with_custom_formatter(self):
        v = GoodValidator()
        df = pd.DataFrame({"a": [1, 2]})

        def formatter(err):
            return {
                "row_index": err["row_index"],
                "cell_value": err["value"],
                "error_message": f"custom: {err['message']}",
            }

        result = v._delegate_validation(df, "a", DummyConstraint(), error_formatter=formatter)
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.error_rows[0]["error_message"] == "custom: wrong"


class TestValidateWithErrorHandling:
    def test_successful_validation(self):
        v = GoodValidator()
        df = pd.DataFrame({"a": [1, 2]})
        result = v.validate_with_error_handling(df, "a")
        assert result.is_valid is True

    def test_catches_exception(self):
        v = BadValidator()
        df = pd.DataFrame({"a": [1, 2]})
        result = v.validate_with_error_handling(df, "a")
        assert result.is_valid is False
        assert result.error_count == 1
        assert result.total_rows == 2
        assert "boom" in result.error_rows[0]["error_message"]

    def test_cannot_instantiate_abstract(self):
        with pytest.raises(TypeError):
            BaseValidator()
