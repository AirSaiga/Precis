# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview 脚本校验器单元测试

测试 ScriptedValidator。
"""

import pandas as pd

from app.shared.services.validation.service import UnifiedValidationService


class TestScriptedValidator:
    def test_script_pass(self):
        df = pd.DataFrame({"price": [100, 200]})
        v = UnifiedValidationService.get_validator("scripted")
        result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        assert result.is_valid is True

    def test_script_fail(self):
        df = pd.DataFrame({"price": [100, 20]})
        v = UnifiedValidationService.get_validator("scripted")
        result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        assert result.is_valid is False
        assert result.error_count == 1

    def test_empty_script(self):
        df = pd.DataFrame({"a": [1]})
        v = UnifiedValidationService.get_validator("scripted")
        result = v.validate(df, "a", script="")
        assert result.is_valid is False
        assert "为空" in result.error_rows[0]["error_message"]

    def test_multi_column_script(self):
        df = pd.DataFrame({"price": [100, 50], "qty": [2, 3], "total": [200, 150]})
        v = UnifiedValidationService.get_validator("scripted")
        result = v.validate(df, "total", script="value == row['price'] * row['qty']", allow_unsafe_eval=True)
        assert result.is_valid is True

    def test_multi_column_script_fail(self):
        df = pd.DataFrame({"price": [100, 50], "qty": [2, 3], "total": [200, 100]})
        v = UnifiedValidationService.get_validator("scripted")
        result = v.validate(df, "total", script="value == row['price'] * row['qty']", allow_unsafe_eval=True)
        assert result.is_valid is False
        assert result.error_count == 1


class TestScriptedValidatorEdgeCases:
    """覆盖 scripted.py 的未覆盖分支"""

    def test_row_index_none(self):
        from unittest.mock import MagicMock

        df = pd.DataFrame({"price": [100, 20]})
        v = UnifiedValidationService.get_validator("scripted")
        mock_constraint = MagicMock()
        mock_constraint.validate.return_value = {"errors": [{"row_index": None, "value": 20, "message": "fail"}]}
        original_cls = v.constraint_cls
        v.constraint_cls = MagicMock(return_value=mock_constraint)
        try:
            result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        finally:
            v.constraint_cls = original_cls
        assert result.is_valid is False
        assert result.error_rows[0]["row_index"] == 0

    def test_row_index_conversion_failure(self):
        from unittest.mock import MagicMock

        df = pd.DataFrame({"price": [100, 20]})
        v = UnifiedValidationService.get_validator("scripted")
        mock_constraint = MagicMock()
        mock_constraint.validate.return_value = {"errors": [{"row_index": "abc", "value": 20, "message": "fail"}]}
        original_cls = v.constraint_cls
        v.constraint_cls = MagicMock(return_value=mock_constraint)
        try:
            result = v.validate(df, "price", script="value > 50", allow_unsafe_eval=True)
        finally:
            v.constraint_cls = original_cls
        assert result.is_valid is False
        assert result.error_rows[0]["row_index"] == 0
