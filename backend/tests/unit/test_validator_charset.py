"""
@fileoverview 字符集校验器单元测试

测试 CharsetValidator（services/validation 层）。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.services.validation.validators.charset import CharsetValidator


class TestCharsetValidator:
    def test_ascii_pass(self):
        df = pd.DataFrame({"code": ["ABC", "123", "xyz"]})
        v = CharsetValidator()
        result = v.validate(df, "code", charset_mode="ascii")
        assert result.is_valid is True
        assert result.error_count == 0

    def test_ascii_fail(self):
        df = pd.DataFrame({"code": ["ABC", "中文"]})
        v = CharsetValidator()
        result = v.validate(df, "code", charset_mode="ascii")
        assert result.is_valid is False
        assert result.error_count == 1

    def test_chinese_pass(self):
        df = pd.DataFrame({"name": ["张三", "李四"]})
        v = CharsetValidator()
        result = v.validate(df, "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_chinese_fail(self):
        df = pd.DataFrame({"name": ["张三", "John"]})
        v = CharsetValidator()
        result = v.validate(df, "name", charset_mode="chinese")
        assert result.is_valid is False
        assert result.error_count == 1

    def test_column_not_found(self):
        df = pd.DataFrame({"a": [1]})
        v = CharsetValidator()
        result = v.validate(df, "missing", charset_mode="ascii")
        assert result.is_valid is False
        assert "不存在" in result.error_rows[0]["error_message"]

    def test_null_ignored(self):
        df = pd.DataFrame({"a": ["ABC", None]})
        v = CharsetValidator()
        result = v.validate(df, "a", charset_mode="ascii")
        assert result.is_valid is True

    def test_empty_string_ignored(self):
        df = pd.DataFrame({"a": ["ABC", ""]})
        v = CharsetValidator()
        result = v.validate(df, "a", charset_mode="ascii")
        assert result.is_valid is True

    def test_default_mode_is_ascii(self):
        df = pd.DataFrame({"a": ["中文"]})
        v = CharsetValidator()
        result = v.validate(df, "a")
        assert result.is_valid is False


class TestCharsetValidatorChineseRanges:
    """覆盖 charset.py 的未覆盖中文字符范围分支"""

    def test_extension_a(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\u3400"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_extension_b(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\U00020000"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_extension_c(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\U0002a700"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_extension_d(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\U0002b740"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_extension_e(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\U0002b820"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_chinese_punctuation(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\u3001"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_fullwidth_chars(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["\uff01"]}), "name", charset_mode="chinese")
        assert result.is_valid is True

    def test_unknown_mode(self):
        v = CharsetValidator()
        result = v.validate(pd.DataFrame({"name": ["abc"]}), "name", charset_mode="unknown")
        assert result.is_valid is True
