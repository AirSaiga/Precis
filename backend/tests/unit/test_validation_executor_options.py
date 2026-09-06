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
@fileoverview ValidationExecutor 选项单元测试

测试 ValidationOptions 和 _apply_settings_override。
"""

import pytest

from app.shared.services.validation.executor import ValidationOptions, create_executor


class TestValidationOptions:
    def test_defaults(self):
        opts = ValidationOptions()
        assert opts.timeout_seconds == 30
        assert opts.error_handling == "continue"
        assert opts.strict_mode is False
        assert opts.allow_unsafe_eval is None
        assert opts.table_filter is None

    def test_custom_values(self):
        opts = ValidationOptions(
            timeout_seconds=60,
            error_handling="stop",
            strict_mode=True,
            allow_unsafe_eval=True,
            table_filter=["users", "orders"],
        )
        assert opts.timeout_seconds == 60
        assert opts.error_handling == "stop"
        assert opts.strict_mode is True
        assert opts.allow_unsafe_eval is True
        assert opts.table_filter == ["users", "orders"]

    def test_table_filter_string(self):
        opts = ValidationOptions(table_filter="users")
        assert opts.table_filter == "users"


class TestCreateExecutor:
    def test_missing_manifest_raises(self):
        with pytest.raises(FileNotFoundError):
            create_executor("/nonexistent/manifest.yaml")
