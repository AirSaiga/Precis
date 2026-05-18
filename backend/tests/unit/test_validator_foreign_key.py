"""
@fileoverview 外键校验器单元测试

测试 ForeignKeyValidator（services/validation 层）。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.services.validation.validators.foreign_key import ForeignKeyValidator


class TestForeignKeyValidator:
    def test_pass(self):
        df = pd.DataFrame({"user_id": [1, 2, 3]})
        v = ForeignKeyValidator()
        result = v.validate(df, "user_id", target_table="users", target_column="id", target_values=[1, 2, 3, 4])
        assert result.is_valid is True

    def test_fail(self):
        df = pd.DataFrame({"user_id": [1, 99]})
        v = ForeignKeyValidator()
        result = v.validate(df, "user_id", target_table="users", target_column="id", target_values=[1, 2, 3])
        assert result.is_valid is False
        assert result.error_count == 1

    def test_missing_target_config(self):
        df = pd.DataFrame({"user_id": [1]})
        v = ForeignKeyValidator()
        result = v.validate(df, "user_id")
        assert result.is_valid is False
        assert "缺少目标表" in result.error_rows[0]["error_message"]

    def test_column_not_found(self):
        df = pd.DataFrame({"a": [1]})
        v = ForeignKeyValidator()
        result = v.validate(df, "missing", target_table="users", target_column="id", target_values=[1])
        assert result.is_valid is False
        assert "不存在" in result.error_rows[0]["error_message"]
