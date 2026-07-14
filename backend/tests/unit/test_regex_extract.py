"""正则提取工具单元测试"""

import pandas as pd

from app.shared.core.utils.regex_extract import (
    apply_extracted_columns_to_dataframe,
    extract_columns_from_values,
)


class TestExtractColumnsFromValues:
    """extract_columns_from_values 单元测试"""

    def test_simple_named_group_extract(self):
        """简单命名捕获组提取"""
        values = ["Alice:25", "Bob:30"]
        extracted, group_names, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<name>\w+):(?P<age>\d+)",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert group_names == ["name", "age"]
        assert extracted["name"] == ["Alice", "Bob"]
        assert extracted["age"] == ["25", "30"]
        assert match_count == 2
        assert error_count == 0

    def test_multiple_groups_extract(self):
        """多组提取"""
        values = ["user@example.com", "admin@test.org"]
        extracted, group_names, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<user>[\w.]+)@(?P<domain>[\w.]+)",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert group_names == ["user", "domain"]
        assert extracted["user"] == ["user", "admin"]
        assert extracted["domain"] == ["example.com", "test.org"]
        assert match_count == 2
        assert error_count == 0

    def test_full_match_mode(self):
        """full match_mode 使用 match()，仅匹配字符串开头"""
        values = ["abc123", "prefix_abc123", "abc123_suffix"]
        extracted, group_names, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<code>\w{3}\d{3})",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="full",
        )
        # match() 只从开头匹配："prefix_abc123" 开头不匹配
        assert match_count == 2
        assert error_count == 1
        assert extracted["code"] == ["abc123", "", "abc123"]

    def test_partial_match_mode(self):
        """partial match_mode 使用 search()，允许任意位置匹配"""
        values = ["prefix_abc123_suffix", "xyz789"]
        extracted, group_names, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<code>\w{3}\d{3})",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="partial",
        )
        assert match_count == 2
        assert error_count == 0
        assert extracted["code"] == ["abc123", "xyz789"]

    def test_case_sensitive(self):
        """case_sensitive=True 区分大小写"""
        values = ["HELLO"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<word>hello)",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert match_count == 0
        assert error_count == 1

    def test_case_insensitive_flag(self):
        """regex_flags 包含 i 时不区分大小写"""
        values = ["HELLO"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<word>hello)",
            regex_flags="i",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert match_count == 1
        assert error_count == 0
        assert extracted["word"] == ["HELLO"]

    def test_case_sensitive_false(self):
        """case_sensitive=False 时不区分大小写"""
        values = ["HELLO"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<word>hello)",
            regex_flags="",
            case_sensitive=False,
            values=values,
            match_mode="extract",
        )
        assert match_count == 1
        assert error_count == 0

    def test_multiline_flag(self):
        """regex_flags 包含 m 时支持多行匹配"""
        values = ["line1\nline2"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<start>^line\d)",
            regex_flags="m",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert match_count == 1
        assert extracted["start"] == ["line1"]

    def test_dotall_flag(self):
        """regex_flags 包含 s 时 . 匹配换行符"""
        values = ["a\nb"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<all>a.b)",
            regex_flags="s",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert match_count == 1
        assert extracted["all"] == ["a\nb"]

    def test_error_count_on_mismatch(self):
        """匹配失败时 error_count 增加"""
        values = ["match", "no_match"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<word>match)",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="full",
        )
        assert match_count == 1
        assert error_count == 1
        assert extracted["word"][1] == ""

    def test_none_value_handling(self):
        """None 值处理为空字符串"""
        values = [None, "test"]
        extracted, _, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"(?P<word>\w+)",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert match_count == 1
        assert error_count == 1
        assert extracted["word"] == ["", "test"]

    def test_no_named_groups(self):
        """无命名捕获组时返回空字典"""
        values = ["abc", "def"]
        extracted, group_names, match_count, error_count = extract_columns_from_values(
            regex_pattern=r"\w+",
            regex_flags="",
            case_sensitive=True,
            values=values,
            match_mode="extract",
        )
        assert group_names == []
        assert extracted == {}
        assert match_count == 2
        assert error_count == 0


class TestApplyExtractedColumnsToDataframe:
    """apply_extracted_columns_to_dataframe 单元测试"""

    def test_apply_single_column(self):
        """将提取的列添加到 DataFrame"""
        df = pd.DataFrame({"raw": ["Alice:25", "Bob:30"]})
        extracted = {"name": ["Alice", "Bob"], "age": ["25", "30"]}
        result = apply_extracted_columns_to_dataframe(df, extracted, ["name", "age"])

        assert "name" in result.columns
        assert "age" in result.columns
        assert result["name"].tolist() == ["Alice", "Bob"]
        assert result["age"].tolist() == ["25", "30"]
        # 原始列保留
        assert "raw" in result.columns

    def test_apply_does_not_modify_original(self):
        """不应修改原始 DataFrame"""
        df = pd.DataFrame({"raw": ["a", "b"]})
        original_cols = list(df.columns)
        extracted = {"new": ["x", "y"]}
        result = apply_extracted_columns_to_dataframe(df, extracted, ["new"])

        assert list(df.columns) == original_cols
        assert "new" not in df.columns
        assert "new" in result.columns

    def test_apply_missing_column_in_extracted(self):
        """extracted_columns 中缺少指定列时跳过"""
        df = pd.DataFrame({"raw": ["a", "b"]})
        extracted = {"exist": ["x", "y"]}
        result = apply_extracted_columns_to_dataframe(df, extracted, ["exist", "missing"])

        assert "exist" in result.columns
        assert "missing" not in result.columns
