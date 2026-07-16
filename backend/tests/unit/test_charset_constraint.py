"""
@fileoverview 字符集约束单元测试

测试 CharsetConstraint 的 ASCII 和中文模式。
"""

import pandas as pd

from app.shared.domain.constraints.charset import CharsetConstraint


class TestCharsetConstraint:
    def test_ascii_pass(self):
        datasets = {"users": pd.DataFrame({"name": ["alice", "bob"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_ascii_fail_with_chinese(self):
        datasets = {"users": pd.DataFrame({"name": ["alice", "张三"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_chinese_pass(self):
        datasets = {"users": pd.DataFrame({"name": ["张三", "李四"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_chinese_fail_with_english(self):
        datasets = {"users": pd.DataFrame({"name": ["张三", "alice"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_null_ignored(self):
        datasets = {"users": pd.DataFrame({"name": ["alice", None]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_empty_string_ignored(self):
        datasets = {"users": pd.DataFrame({"name": ["alice", ""]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_table_not_found(self):
        c = CharsetConstraint(table="missing", column="x", charset_mode="ascii")
        result = c.validate({})
        assert len(result["errors"]) == 1
        assert "不在数据集中" in result["errors"][0]["message"]

    def test_column_not_found(self):
        datasets = {"users": pd.DataFrame({"name": ["alice"]})}
        c = CharsetConstraint(table="users", column="missing", charset_mode="ascii")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert "不存在" in result["errors"][0]["message"]

    def test_unknown_charset_mode_reports_config_error(self):
        """回归 D3: 未识别的 charset_mode(如拼错的 chinese_mix)不应静默放行。

        原实现 _check_charset 对未识别 mode 返回 True → 约束永远通过、零提示,用户以为
        字符集被强制了实际没有。应报 ConstraintConfigError 让用户发现配置拼写错误。
        """
        datasets = {"users": pd.DataFrame({"name": ["alice", "张三"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese_mix")  # 拼错
        result = c.validate(datasets)

        assert len(result["errors"]) == 1, f"未知 mode 应报配置错误,实际: {result['errors']}"
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "chinese_mix" in result["errors"][0]["message"]

    def test_get_description_ascii(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii")
        assert "ASCII" in c._get_description()

    def test_get_description_chinese(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese")
        assert "中文" in c._get_description()

    def test_custom_description(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii", description="custom")
        assert c._get_description() == "custom"

    def test_chinese_mixed_pass_with_chinese_and_ascii(self):
        datasets = {"users": pd.DataFrame({"name": ["张三", "Alice123", "Hello 世界"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_chinese_mixed_pass_with_common_punctuation(self):
        datasets = {"users": pd.DataFrame({"name": ["Hello, 世界!", "Test-123_456"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_chinese_mixed_fail_with_non_ascii_non_chinese(self):
        datasets = {"users": pd.DataFrame({"name": ["日本語ひらがな", "café"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert len(result["errors"]) == 2
        assert all(e["error_type"] == "CharsetViolation" for e in result["errors"])

    def test_unknown_mode_reports_config_error(self):
        """回归 D3: 未知 mode 不应静默放行(原 test_unknown_mode_returns_true 固化了 bug)。
        未知 mode 应报 ConstraintConfigError,而非让约束永远通过零提示。
        """
        datasets = {"users": pd.DataFrame({"name": ["anything", "123"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="unknown")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "unknown" in result["errors"][0]["message"]

    def test_chinese_mixed_pass_with_letters_numbers_punctuation(self):
        datasets = {
            "users": pd.DataFrame(
                {
                    "memo": [
                        "你好，world!",
                        "测试123",
                        "CJK与ASCII混合（ok）",
                    ]
                }
            )
        }
        c = CharsetConstraint(table="users", column="memo", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_chinese_mixed_fail_with_non_allowed_ascii_symbol(self):
        datasets = {"users": pd.DataFrame({"memo": ["你好§world"]})}
        c = CharsetConstraint(table="users", column="memo", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "CharsetViolation"

    def test_chinese_mixed_fail_with_non_cjk_non_ascii(self):
        datasets = {"users": pd.DataFrame({"memo": ["你好мир"]})}
        c = CharsetConstraint(table="users", column="memo", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1

    def test_chinese_mixed_allows_pure_chinese(self):
        datasets = {"users": pd.DataFrame({"memo": ["张三", "李四"]})}
        c = CharsetConstraint(table="users", column="memo", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_chinese_mixed_allows_pure_ascii_alphanumeric(self):
        datasets = {"users": pd.DataFrame({"memo": ["hello", "WORLD123"]})}
        c = CharsetConstraint(table="users", column="memo", charset_mode="chinese_mixed")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_get_description_chinese_mixed(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese_mixed")
        assert "中文混合" in c._get_description()
