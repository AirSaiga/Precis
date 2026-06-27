"""@fileoverview AI 迁移任务 checkpoint 续跑端点测试

覆盖:
- _run_migrate_job 的 checkpoint_callback 调用 storage.save_checkpoint
- /resume 端点: 有 checkpoint → 后台重启; 无 checkpoint → 404
"""

from __future__ import annotations

import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.ai.migrate import router as migrate_router


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(migrate_router)
    return app


@pytest.fixture
def temp_config_path():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_run_migrate_job_checkpoint_callback_saves_to_storage(temp_config_path):
    """_run_migrate_job 的 checkpoint_callback 应调用 storage.save_checkpoint。"""
    from app.api.routers.ai.migrate import _run_migrate_job
    from app.api.routers.ai.models import ConfigGenerateOptions, ConfigMigrateRequest

    payload = ConfigMigrateRequest(
        script_content="print('hello')",
        language="python",
        file_paths=["test.xlsx"],
        project_name="Test",
        project_id="test-001",
        options=ConfigGenerateOptions(max_iterations=2),
    )

    mock_storage = MagicMock()
    mock_storage.load_status.return_value = {"status": "running", "created_at": "2026-01-01T00:00:00"}
    mock_storage.save_status = MagicMock()
    mock_storage.save_checkpoint = MagicMock()

    mock_service = MagicMock()
    mock_service.migrate_from_script = AsyncMock(
        return_value={
            "success": True,
            "yaml_preview": "",
            "manifest": None,
            "schemas": {},
            "constraints": {},
            "regex_nodes": {},
            "warnings": [],
            "iterations": 1,
        }
    )

    with (
        patch("app.api.routers.ai.migrate._get_storage", return_value=mock_storage),
        patch("app.api.routers.ai.migrate.ConfigMigrationService", return_value=mock_service),
    ):
        import asyncio

        asyncio.run(_run_migrate_job("job_test", payload, temp_config_path))

    call_kwargs = mock_service.migrate_from_script.call_args.kwargs
    assert "checkpoint_callback" in call_kwargs
    checkpoint_cb = call_kwargs["checkpoint_callback"]
    assert checkpoint_cb is not None

    checkpoint_cb({"turn": 1, "messages": []})
    mock_storage.save_checkpoint.assert_called_once_with("job_test", {"turn": 1, "messages": []})


def test_migrate_resume_endpoint_with_checkpoint_returns_200(temp_config_path):
    """migrate /resume 端点: 有 checkpoint → 返回 200 + resuming 状态。"""
    mock_storage = MagicMock()
    mock_storage.load_latest_checkpoint.return_value = {"turn": 1, "messages": [{"role": "user", "content": "test"}]}
    mock_storage.load_status.return_value = {
        "status": "failed",
        "created_at": "2026-01-01T00:00:00",
        "max_iterations": 3,
    }
    mock_storage.load_full.return_value = {
        "payload": {
            "script_content": "print('hello')",
            "language": "python",
            "file_paths": ["test.xlsx"],
            "project_name": "Test",
            "project_id": "test-001",
            "max_iterations": 3,
        }
    }
    mock_storage.save_status = MagicMock()

    with (
        patch("app.api.routers.ai.migrate._get_storage", return_value=mock_storage),
        patch("app.api.routers.ai.migrate._run_migrate_job") as mock_run,
    ):
        client = TestClient(_app())
        response = client.post(
            "/api/latest/ai/config/migrate/jobs/job_test/resume",
            headers={"X-Project-Config-Path": temp_config_path},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "resuming"
    assert data["turn"] == 1
    mock_run.assert_called_once()
    call_kwargs = mock_run.call_args.kwargs
    assert "initial_checkpoint" in call_kwargs
    assert call_kwargs["initial_checkpoint"]["turn"] == 1


def test_migrate_resume_endpoint_without_checkpoint_returns_404(temp_config_path):
    """migrate /resume 端点: 无 checkpoint → 返回 404。"""
    client = TestClient(_app())

    mock_storage = MagicMock()
    mock_storage.load_latest_checkpoint.return_value = None

    with patch("app.api.routers.ai.migrate._get_storage", return_value=mock_storage):
        response = client.post(
            "/api/latest/ai/config/migrate/jobs/job_test/resume",
            headers={"X-Project-Config-Path": temp_config_path},
        )

    assert response.status_code == 404
