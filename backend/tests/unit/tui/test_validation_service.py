# backend/tests/unit/tui/test_validation_service.py
"""@fileoverview ValidationService 单元测试（P1）

验证 ValidationService 的行为，mock 边界为 ValidationExecutor：
- 选项构建契约（timeout 默认 30、非正回退 30、allow_unsafe_eval 三段式逻辑）
- 结果字段映射（errors/loading_errors/duration_ms/validation_details/raw_datasets）
- 无显式 settings 时使用默认值
- raw_datasets/validation_details 为空时的兜底

不触碰真实文件系统与真实校验执行——仅在 executor 模块注入假实现。
"""

from __future__ import annotations

import os
import sys

import pytest

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.tui.services.validation_service import ValidationResult, ValidationService  # noqa: E402
from app.shared.services.validation import executor as executor_module  # noqa: E402


class _FakeOptions:
    """记录 service 传入的 ValidationOptions 参数，便于断言契约。"""

    def __init__(self, **kwargs: object) -> None:
        self.__dict__.update(kwargs)


class _FakeExecutor:
    """假 ValidationExecutor，记录构造参数与 execute 调用参数。"""

    # 类级记录，便于测试断言
    last_manifest_path: str | None = None
    last_execute_args: dict | None = None
    next_result: dict | None = None

    def __init__(self, manifest_path: str) -> None:
        _FakeExecutor.last_manifest_path = manifest_path
        # 真实 executor 在此校验文件存在性；假实现跳过

    def execute(self, data_directory: str, options: object | None = None) -> dict:
        _FakeExecutor.last_execute_args = {
            "data_directory": data_directory,
            "options": options,
        }
        return _FakeExecutor.next_result or {}


def _install_fake_executor(monkeypatch, result: dict | None = None) -> None:
    """在 executor 模块注入假 ValidationExecutor 与假 ValidationOptions。

    Args:
        monkeypatch: pytest monkeypatch fixture。
        result: executor.execute 应返回的结果字典。
    """
    _FakeExecutor.last_manifest_path = None
    _FakeExecutor.last_execute_args = None
    _FakeExecutor.next_result = result

    monkeypatch.setattr(executor_module, "ValidationExecutor", _FakeExecutor)
    monkeypatch.setattr(
        executor_module,
        "ValidationOptions",
        _FakeOptions,
    )


def test_validate_maps_result_fields(monkeypatch):
    """validate 应把 executor 返回字典的关键字段映射到 ValidationResult。"""
    fake_result = {
        "errors": [{"error_type": "NotNullViolation", "table": "users", "message": "x"}],
        "loading_errors": [{"error_type": "SchemaWarning", "title": "t"}],
        "duration_ms": 42,
        "validation_details": {"format_checks": [{"table": "users"}], "constraint_checks": []},
        "raw_datasets": {"users": "df"},
    }
    _install_fake_executor(monkeypatch, fake_result)

    svc = ValidationService()
    result = svc.validate("/abs/manifest.yaml", "/abs/data")

    assert isinstance(result, ValidationResult)
    assert result.errors == fake_result["errors"]
    assert result.loading_errors == fake_result["loading_errors"]
    assert result.duration_ms == 42
    assert result.validation_details == fake_result["validation_details"]
    assert result.raw_datasets == fake_result["raw_datasets"]
    assert result.has_errors is True
    # executor 被以 manifest_path 构造、execute 以 data_dir 调用
    assert _FakeExecutor.last_manifest_path == "/abs/manifest.yaml"
    assert _FakeExecutor.last_execute_args["data_directory"] == "/abs/data"


def test_validate_no_errors_has_errors_false(monkeypatch):
    """无错误时 has_errors 应为 False。"""
    _install_fake_executor(
        monkeypatch,
        {"errors": [], "loading_errors": [], "duration_ms": 10, "validation_details": {}, "raw_datasets": {}},
    )
    svc = ValidationService()
    result = svc.validate("/m.yaml", "/d")
    assert result.has_errors is False


def test_validate_defaults_timeout_to_30(monkeypatch):
    """无 validation_settings 时 timeout_seconds 应默认 30。"""
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()
    svc.validate("/m.yaml", "/d")
    options = _FakeExecutor.last_execute_args["options"]
    assert options.timeout_seconds == 30


def test_validate_nonpositive_timeout_falls_back_to_30(monkeypatch):
    """timeout_seconds <= 0 时应回退 30（与 CLI 一致）。"""
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()
    svc.validate("/m.yaml", "/d", validation_settings={"timeout_seconds": 0})
    assert _FakeExecutor.last_execute_args["options"].timeout_seconds == 30

    svc.validate("/m.yaml", "/d", validation_settings={"timeout_seconds": -5})
    assert _FakeExecutor.last_execute_args["options"].timeout_seconds == 30


def test_validate_uses_configured_timeout(monkeypatch):
    """显式 timeout_seconds 应透传给 options。"""
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()
    svc.validate("/m.yaml", "/d", validation_settings={"timeout_seconds": 60})
    assert _FakeExecutor.last_execute_args["options"].timeout_seconds == 60


def test_validate_allow_unsafe_eval_none_when_no_security(monkeypatch):
    """script_security 缺失 allow_eval/allow_exec 时 allow_unsafe_eval 应为 None。"""
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()
    svc.validate("/m.yaml", "/d", script_security={})
    assert _FakeExecutor.last_execute_args["options"].allow_unsafe_eval is None

    # 完全不传 script_security 同样 None
    svc.validate("/m.yaml", "/d")
    assert _FakeExecutor.last_execute_args["options"].allow_unsafe_eval is None


def test_validate_allow_unsafe_eval_or_of_eval_and_exec(monkeypatch):
    """allow_eval/allow_exec 任一存在时取其或值（与 CLI _run_validation 一致）。"""
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()

    # allow_eval=True, allow_exec 缺失 -> True
    svc.validate("/m.yaml", "/d", script_security={"allow_eval": True})
    assert _FakeExecutor.last_execute_args["options"].allow_unsafe_eval is True

    # allow_eval=False, allow_exec=True -> True
    svc.validate("/m.yaml", "/d", script_security={"allow_eval": False, "allow_exec": True})
    assert _FakeExecutor.last_execute_args["options"].allow_unsafe_eval is True

    # allow_eval=False, allow_exec=False -> False
    svc.validate("/m.yaml", "/d", script_security={"allow_eval": False, "allow_exec": False})
    assert _FakeExecutor.last_execute_args["options"].allow_unsafe_eval is False


def test_validate_passes_table_filter(monkeypatch):
    """table 参数应作为 table_filter 透传。"""
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()
    svc.validate("/m.yaml", "/d", table="users")
    assert _FakeExecutor.last_execute_args["options"].table_filter == "users"


def test_validate_empty_result_defaults(monkeypatch):
    """executor 返回空字典时结果字段应为默认空值，不抛异常。"""
    _install_fake_executor(monkeypatch, {})
    svc = ValidationService()
    result = svc.validate("/m.yaml", "/d")
    assert result.errors == []
    assert result.loading_errors == []
    assert result.duration_ms == 0
    assert result.validation_details is None
    assert result.raw_datasets is None
    assert result.has_errors is False


def test_validate_restores_inspector_log_level(monkeypatch):
    """validate 应在结束时恢复 config_inspector logger 的原始级别。"""
    import logging

    inspector_logger = logging.getLogger("app.shared.core.project.loader.loader_parts.config_inspector")
    original_level = inspector_logger.level
    _install_fake_executor(monkeypatch, {"errors": [], "duration_ms": 0})
    svc = ValidationService()

    try:
        svc.validate("/m.yaml", "/d")
        # 校验期间被设为 ERROR，结束后应恢复
        assert inspector_logger.level == original_level
    finally:
        inspector_logger.setLevel(original_level)


def test_validate_propagates_executor_exception(monkeypatch):
    """executor 抛异常时应原样上抛（由 UI 层捕获）。"""

    class _BoomExecutor:
        def __init__(self, manifest_path: str) -> None:
            pass

        def execute(self, data_directory: str, options: object | None = None) -> dict:
            raise RuntimeError("boom")

    monkeypatch.setattr(executor_module, "ValidationExecutor", _BoomExecutor)
    monkeypatch.setattr(executor_module, "ValidationOptions", _FakeOptions)

    svc = ValidationService()
    with pytest.raises(RuntimeError, match="boom"):
        svc.validate("/m.yaml", "/d")
