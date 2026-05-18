"""
@fileoverview 校验器基类单元测试

测试 BaseValidator.validate_with_error_handling 和抽象方法。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

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
