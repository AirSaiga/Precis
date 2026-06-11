"""
@fileoverview 正则校验器单元测试

测试 RegexValidator。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.services.validation.service import UnifiedValidationService


class TestRegexValidator:
    def test_full_match_pass(self):
        df = pd.DataFrame({"email": ["a@b.com", "x@y.co"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "email", regex_pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$")
        assert result.is_valid is True

    def test_full_match_fail(self):
        df = pd.DataFrame({"email": ["a@b.com", "invalid"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "email", regex_pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$")
        assert result.is_valid is False
        assert result.error_count == 1

    def test_search_mode_pass(self):
        df = pd.DataFrame({"text": ["hello world", "foo world bar"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "text", regex_pattern=r"world", match_mode="search")
        assert result.is_valid is True

    def test_search_mode_fail(self):
        df = pd.DataFrame({"text": ["hello", "foo bar"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "text", regex_pattern=r"world", match_mode="search")
        assert result.is_valid is False
        assert result.error_count == 2

    def test_column_not_found(self):
        df = pd.DataFrame({"a": [1]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "missing", regex_pattern=r".*")
        assert result.is_valid is False
        assert "不存在" in result.error_rows[0]["error_message"]

    def test_empty_pattern(self):
        df = pd.DataFrame({"a": ["x"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "a", regex_pattern="")
        assert result.is_valid is False
        assert "不能为空" in result.error_rows[0]["error_message"]

    def test_invalid_regex_syntax(self):
        df = pd.DataFrame({"a": ["x"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "a", regex_pattern="[invalid")
        assert result.is_valid is False
        assert "语法错误" in result.error_rows[0]["error_message"]

    def test_case_insensitive_flag(self):
        df = pd.DataFrame({"code": ["ABC", "abc"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "code", regex_pattern=r"^[A-Z]+$", regex_flags="i")
        assert result.is_valid is True

    def test_case_sensitive_false(self):
        df = pd.DataFrame({"code": ["ABC", "abc"]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "code", regex_pattern=r"^[A-Z]+$", case_sensitive=False)
        assert result.is_valid is True

    def test_null_skipped(self):
        df = pd.DataFrame({"a": ["ABC", None]})
        v = UnifiedValidationService.get_validator("regex")
        result = v.validate(df, "a", regex_pattern=r"^[A-Z]+$")
        assert result.is_valid is True
