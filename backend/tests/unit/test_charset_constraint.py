"""
@fileoverview 字符集约束单元测试

测试 CharsetConstraint 的 ASCII 和中文模式。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

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

    def test_get_description_ascii(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii")
        assert "ASCII" in c._get_description()

    def test_get_description_chinese(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="chinese")
        assert "中文" in c._get_description()

    def test_custom_description(self):
        c = CharsetConstraint(table="users", column="name", charset_mode="ascii", description="custom")
        assert c._get_description() == "custom"

    def test_unknown_mode_returns_true(self):
        datasets = {"users": pd.DataFrame({"name": ["anything", "123"]})}
        c = CharsetConstraint(table="users", column="name", charset_mode="unknown")
        result = c.validate(datasets)
        assert result["errors"] == []
