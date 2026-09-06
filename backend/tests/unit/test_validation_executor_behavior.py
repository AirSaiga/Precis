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
@fileoverview 校验执行器设置覆盖行为测试

覆盖 ValidationExecutor._apply_settings_override 的输入校验与应用。
"""

from __future__ import annotations

import pytest

from app.shared.services.validation.executor import ValidationExecutor


class _FakeValidation:
    max_rows = 100


class _FakeFileProcessing:
    encoding = "utf-8"


class _FakeScriptSecurity:
    allow_eval = False


class _FakeSettings:
    validation = _FakeValidation()
    file_processing = _FakeFileProcessing()
    script_security = _FakeScriptSecurity()


class TestApplySettingsOverride:
    """_apply_settings_override 行为测试"""

    def _make_executor(self):
        executor = ValidationExecutor.__new__(ValidationExecutor)
        executor.settings = _FakeSettings()
        return executor

    def test_none_does_nothing(self):
        executor = self._make_executor()
        executor._apply_settings_override(None)
        assert executor.settings.validation.max_rows == 100

    def test_dict_override_applies(self):
        executor = self._make_executor()
        executor._apply_settings_override({"validation": {"max_rows": 99}})
        assert executor.settings.validation.max_rows == 99

    def test_pydantic_model_override(self):
        class FakeSettings:
            def model_dump(self, exclude_none=True):
                return {"validation": {"max_rows": 50}}

        executor = self._make_executor()
        executor._apply_settings_override(FakeSettings())
        assert executor.settings.validation.max_rows == 50

    def test_unknown_root_raises_value_error(self):
        executor = self._make_executor()
        with pytest.raises(ValueError):
            executor._apply_settings_override({"unknown_group": {"x": 1}})

    def test_unknown_field_raises_value_error(self):
        executor = self._make_executor()
        with pytest.raises(ValueError):
            executor._apply_settings_override({"validation": {"nonexistent": 1}})

    def test_invalid_type_raises_type_error(self):
        executor = self._make_executor()
        with pytest.raises(TypeError):
            executor._apply_settings_override("bad")
