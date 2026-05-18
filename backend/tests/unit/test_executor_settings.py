"""
@fileoverview ValidationExecutor 设置覆盖单元测试

测试 _apply_settings_override 的各种分支。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock, patch

import pytest

from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions


class MockValidation:
    timeout_seconds = 30
    error_handling = "continue"


class MockFileProcessing:
    default_encoding = "utf-8"


class MockScriptSecurity:
    allow_eval = False


class MockSettings:
    def __init__(self):
        self.validation = MockValidation()
        self.file_processing = MockFileProcessing()
        self.script_security = MockScriptSecurity()


class MockLoadedProject:
    def __init__(self):
        self.manifest = MagicMock()
        self.manifest.settings = MockSettings()
        self.manifest.settings_override = None
        self.schema_files = {}
        self.dataset_schema = MagicMock()


def _make_executor():
    with (
        patch("app.shared.services.validation.executor.load_project") as mock_load,
        patch("os.path.exists", return_value=True),
    ):
        mock_load.return_value = MockLoadedProject()
        return ValidationExecutor("D:\\fake\\project.precis.yaml")


class TestApplySettingsOverride:
    def test_none_override(self):
        executor = _make_executor()
        # Should not raise
        executor._apply_settings_override(None)

    def test_dict_override(self):
        executor = _make_executor()
        executor._apply_settings_override(
            {
                "validation": {"timeout_seconds": 60, "error_handling": "stop"},
                "file_processing": {"default_encoding": "gbk"},
            }
        )
        assert executor.settings.validation.timeout_seconds == 60
        assert executor.settings.validation.error_handling == "stop"
        assert executor.settings.file_processing.default_encoding == "gbk"

    def test_pydantic_override(self):
        executor = _make_executor()
        model = MagicMock()
        model.model_dump.return_value = {"validation": {"timeout_seconds": 45}}
        executor._apply_settings_override(model)
        assert executor.settings.validation.timeout_seconds == 45

    def test_invalid_type(self):
        executor = _make_executor()
        with pytest.raises(TypeError):
            executor._apply_settings_override("invalid")

    def test_unknown_root_key(self):
        executor = _make_executor()
        with pytest.raises(ValueError) as exc_info:
            executor._apply_settings_override({"unknown": {"key": "value"}})
        assert "unknown" in str(exc_info.value)

    def test_non_dict_group(self):
        executor = _make_executor()
        with pytest.raises(ValueError) as exc_info:
            executor._apply_settings_override({"validation": "not_a_dict"})
        assert "必须为对象" in str(exc_info.value)

    def test_unknown_group_field(self):
        executor = _make_executor()
        with pytest.raises(ValueError) as exc_info:
            executor._apply_settings_override({"validation": {"nonexistent": 123}})
        assert "nonexistent" in str(exc_info.value)

    def test_script_security_override(self):
        executor = _make_executor()
        executor._apply_settings_override({"script_security": {"allow_eval": True}})
        assert executor.settings.script_security.allow_eval is True


class TestValidationOptions:
    def test_defaults(self):
        opts = ValidationOptions()
        assert opts.timeout_seconds == 30
        assert opts.error_handling == "continue"
        assert opts.strict_mode is False
        assert opts.allow_unsafe_eval is None
        assert opts.table_filter is None

    def test_custom_values(self):
        opts = ValidationOptions(timeout_seconds=10, error_handling="stop", strict_mode=True, table_filter=["t1", "t2"])
        assert opts.timeout_seconds == 10
        assert opts.error_handling == "stop"
        assert opts.strict_mode is True
        assert opts.table_filter == ["t1", "t2"]
