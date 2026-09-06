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
@fileoverview 条件校验器单元测试

测试 ConditionalValidator。
"""

import pandas as pd

from app.shared.services.validation.service import UnifiedValidationService


class TestConditionalValidator:
    def test_simple_condition_pass(self):
        df = pd.DataFrame({"status": ["active", "inactive"], "email": ["a@b.com", ""]})
        v = UnifiedValidationService.get_validator("conditional")
        result = v.validate(df, "email", if_column="status", if_value="active", then_condition={"operator": "not_null"})
        assert result.is_valid is True

    def test_simple_condition_fail(self):
        df = pd.DataFrame({"status": ["active", "active"], "email": ["a@b.com", ""]})
        v = UnifiedValidationService.get_validator("conditional")
        result = v.validate(df, "email", if_column="status", if_value="active", then_condition={"operator": "not_null"})
        assert result.is_valid is False
        assert result.error_count == 1

    def test_missing_then_condition(self):
        df = pd.DataFrame({"a": [1]})
        v = UnifiedValidationService.get_validator("conditional")
        result = v.validate(df, "a", if_column="a", if_value=1)
        assert result.is_valid is False
        assert "不完整" in result.error_rows[0]["error_message"]

    def test_missing_if_column_when_no_conditions(self):
        df = pd.DataFrame({"a": [1]})
        v = UnifiedValidationService.get_validator("conditional")
        result = v.validate(df, "a", then_condition="not_null")
        assert result.is_valid is False
        assert "不完整" in result.error_rows[0]["error_message"]

    def test_complex_condition_and_pass(self):
        df = pd.DataFrame({"type": ["vip", "normal"], "amount": [1500, 200], "discount": [100, 50]})
        v = UnifiedValidationService.get_validator("conditional")
        result = v.validate(
            df,
            "discount",
            if_conditions=[
                {"column": "type", "operator": "eq", "value": "vip"},
                {"column": "amount", "operator": "greater_than", "value": 1000},
            ],
            if_logic="and",
            then_condition={"operator": "greater_than", "value": 0},
        )
        assert result.is_valid is True

    def test_complex_condition_and_fail(self):
        df = pd.DataFrame({"type": ["vip", "vip"], "amount": [1500, 1500], "discount": [100, -10]})
        v = UnifiedValidationService.get_validator("conditional")
        result = v.validate(
            df,
            "discount",
            if_conditions=[
                {"column": "type", "operator": "eq", "value": "vip"},
                {"column": "amount", "operator": "greater_than", "value": 1000},
            ],
            if_logic="and",
            then_condition={"operator": "greater_than", "value": 0},
        )
        assert result.is_valid is False
        assert result.error_count == 1
