"""
@fileoverview 脚本校验器单元测试

测试 ScriptedValidator。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.services.validation.validators.scripted import ScriptedValidator


class TestScriptedValidator:
    def test_script_pass(self):
        df = pd.DataFrame({"price": [100, 200]})
        v = ScriptedValidator()
        result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        assert result.is_valid is True

    def test_script_fail(self):
        df = pd.DataFrame({"price": [100, 20]})
        v = ScriptedValidator()
        result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        assert result.is_valid is False
        assert result.error_count == 1

    def test_empty_script(self):
        df = pd.DataFrame({"a": [1]})
        v = ScriptedValidator()
        result = v.validate(df, "a", script="")
        assert result.is_valid is False
        assert "为空" in result.error_rows[0]["error_message"]

    def test_multi_column_script(self):
        df = pd.DataFrame({"price": [100, 50], "qty": [2, 3], "total": [200, 150]})
        v = ScriptedValidator()
        result = v.validate(df, "total", script="value == row['price'] * row['qty']", allow_unsafe_eval=True)
        assert result.is_valid is True

    def test_multi_column_script_fail(self):
        df = pd.DataFrame({"price": [100, 50], "qty": [2, 3], "total": [200, 100]})
        v = ScriptedValidator()
        result = v.validate(df, "total", script="value == row['price'] * row['qty']", allow_unsafe_eval=True)
        assert result.is_valid is False
        assert result.error_count == 1


class TestScriptedValidatorEdgeCases:
    """覆盖 scripted.py 的未覆盖分支"""

    def test_row_index_none(self):
        from unittest.mock import MagicMock, patch

        df = pd.DataFrame({"price": [100, 20]})
        v = ScriptedValidator()
        mock_result = {"errors": [{"row_index": None, "value": 20, "message": "fail"}]}
        with patch("app.shared.services.validation.validators.scripted.ScriptedConstraint") as MockConstraint:
            instance = MagicMock()
            instance.validate.return_value = mock_result
            MockConstraint.return_value = instance
            result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        assert result.is_valid is False
        assert result.error_rows[0]["row_index"] == 0

    def test_row_index_conversion_failure(self):
        from unittest.mock import MagicMock, patch

        df = pd.DataFrame({"price": [100, 20]})
        v = ScriptedValidator()
        mock_result = {"errors": [{"row_index": "abc", "value": 20, "message": "fail"}]}
        with patch("app.shared.services.validation.validators.scripted.ScriptedConstraint") as MockConstraint:
            instance = MagicMock()
            instance.validate.return_value = mock_result
            MockConstraint.return_value = instance
            result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        assert result.is_valid is False
        assert result.error_rows[0]["row_index"] == 0
