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
@fileoverview 外键校验器单元测试

测试 ForeignKeyValidator（services/validation 层）。
"""

import pandas as pd

from app.shared.services.validation.service import UnifiedValidationService


class TestForeignKeyValidator:
    def test_pass(self):
        df = pd.DataFrame({"user_id": [1, 2, 3]})
        v = UnifiedValidationService.get_validator("foreign_key")
        result = v.validate(df, "user_id", target_table="users", target_column="id", target_values=[1, 2, 3, 4])
        assert result.is_valid is True

    def test_fail(self):
        df = pd.DataFrame({"user_id": [1, 99]})
        v = UnifiedValidationService.get_validator("foreign_key")
        result = v.validate(df, "user_id", target_table="users", target_column="id", target_values=[1, 2, 3])
        assert result.is_valid is False
        assert result.error_count == 1

    def test_missing_target_config(self):
        df = pd.DataFrame({"user_id": [1]})
        v = UnifiedValidationService.get_validator("foreign_key")
        result = v.validate(df, "user_id")
        assert result.is_valid is False
        assert "缺少目标表" in result.error_rows[0]["error_message"]

    def test_column_not_found(self):
        df = pd.DataFrame({"a": [1]})
        v = UnifiedValidationService.get_validator("foreign_key")
        result = v.validate(df, "missing", target_table="users", target_column="id", target_values=[1])
        assert result.is_valid is False
        assert "不存在" in result.error_rows[0]["error_message"]
