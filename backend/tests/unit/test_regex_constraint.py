"""
@fileoverview 正则表达式约束单元测试

验证 RegexConstraint 在表缺失、列缺失、空 pattern 等配置错误场景下
返回 ConstraintConfigError，而非静默通过。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.domain.constraints.regex import RegexConstraint


class TestRegexConstraint:
    def _make_constraint(self, **kwargs):
        defaults = {"table": "users", "column": "email", "pattern": r"^[a-z]+@[a-z]+\.[a-z]+$"}
        defaults.update(kwargs)
        return RegexConstraint(**defaults)

    def test_table_not_found_returns_config_error(self):
        c = self._make_constraint(table="missing")
        result = c.validate({})
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "表" in result["errors"][0]["message"]

    def test_column_not_found_returns_config_error(self):
        datasets = {"users": pd.DataFrame({"name": ["alice"]})}
        c = self._make_constraint(column="email")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "列" in result["errors"][0]["message"]

    def test_empty_pattern_returns_config_error(self):
        datasets = {"users": pd.DataFrame({"email": ["a@b.com"]})}
        c = self._make_constraint(pattern="")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error_type"] == "ConstraintConfigError"
        assert "pattern" in result["errors"][0]["message"].lower()

    def test_valid_pattern_passes(self):
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", "c@d.org"]})}
        c = self._make_constraint(pattern=r"^[a-z]+@[a-z]+\.[a-z]+$")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_invalid_value_fails(self):
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", "invalid"]})}
        c = self._make_constraint(pattern=r"^[a-z]+@[a-z]+\.[a-z]+$")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row_index"] == 1

    def test_invalid_regex_pattern_returns_error(self):
        datasets = {"users": pd.DataFrame({"email": ["a@b.com"]})}
        c = self._make_constraint(pattern=r"[invalid")
        result = c.validate(datasets)
        assert len(result["errors"]) == 1
        assert "正则表达式语法错误" in result["errors"][0]["message"]

    def test_null_values_are_ignored(self):
        datasets = {"users": pd.DataFrame({"email": ["a@b.com", None]})}
        c = self._make_constraint(pattern=r"^[a-z]+@[a-z]+\.[a-z]+$")
        result = c.validate(datasets)
        assert result["errors"] == []

    def test_case_sensitive_flag_respected(self):
        """B22/B24 回归：case_sensitive=False 应允许大小写混合值通过。"""
        datasets = {"users": pd.DataFrame({"email": ["A@B.COM"]})}
        c = self._make_constraint(pattern=r"^[a-z]+@[a-z]+\.[a-z]+$", case_sensitive=False)
        result = c.validate(datasets)
        assert result["errors"] == []

        # 反向：区分大小写时应报错
        c2 = self._make_constraint(pattern=r"^[a-z]+@[a-z]+\.[a-z]+$", case_sensitive=True)
        result2 = c2.validate(datasets)
        assert len(result2["errors"]) == 1

    def test_flags_string_respected(self):
        """B22/B24 回归：flags='i' 应触发忽略大小写。"""
        datasets = {"users": pd.DataFrame({"email": ["A@B.COM"]})}
        c = self._make_constraint(pattern=r"^[a-z]+@[a-z]+\.[a-z]+$", flags="i")
        result = c.validate(datasets)
        assert result["errors"] == []
