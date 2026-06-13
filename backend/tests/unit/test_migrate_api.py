"""@fileoverview AI 配置迁移 API 单元测试

覆盖迁移任务状态流转：成功、失败、取消。
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from app.api.routers.ai.models import ConfigMigrateRequest


@pytest.fixture
def payload():
    """构造标准迁移请求。"""
    return ConfigMigrateRequest(
        script_content="",
        language="python",
        file_paths=["data/users.csv"],
        project_name="test",
        project_id="test",
        provider_id="fake",
        sources=[{"content": "print(1)", "language": "python", "name": "test.py"}],
    )


@pytest.fixture
def mock_storage(tmp_path):
    """构造内存中的任务存储。"""
    storage = MagicMock()
    storage._data: dict[str, dict[str, Any]] = {}

    def save_status(job_id, data):
        storage._data[job_id] = {**data}

    def load_status(job_id):
        return storage._data.get(job_id)

    storage.save_status.side_effect = save_status
    storage.load_status.side_effect = load_status
    storage.cleanup_old_jobs.return_value = None
    return storage


@pytest.mark.asyncio
async def test_run_migrate_job_marks_failed_when_success_false(payload, mock_storage, tmp_path):
    """迁移服务返回 success=False 时，任务状态应为 failed。"""
    from app.api.routers.ai import migrate as migrate_module

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        service_mock = AsyncMock()
        service_mock.migrate_from_script.return_value = {
            "success": False,
            "error": "未能解析出有效配置",
            "yaml_preview": "",
            "manifest": None,
            "schemas": {},
            "constraints": {},
            "regex_nodes": {},
            "warnings": [],
            "iterations": 0,
        }

        with patch(
            "app.api.routers.ai.migrate.ConfigMigrationService",
            return_value=service_mock,
        ):
            await migrate_module._run_migrate_job("job_1", payload, str(tmp_path))

    status = mock_storage.load_status("job_1")
    assert status is not None
    assert status["status"] == "failed"
    assert status["error"] == "未能解析出有效配置"
    assert status["result"]["success"] is False


@pytest.mark.asyncio
async def test_run_migrate_job_marks_completed_when_success_true(payload, mock_storage, tmp_path):
    """迁移服务返回 success=True 时，任务状态应为 completed。"""
    from app.api.routers.ai import migrate as migrate_module

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        service_mock = AsyncMock()
        service_mock.migrate_from_script.return_value = {
            "success": True,
            "yaml_preview": "schemas:",
            "manifest": {"version": 2},
            "schemas": {"users": {}},
            "constraints": {},
            "regex_nodes": {},
            "warnings": [],
            "iterations": 1,
            "metrics": {"passed": 1, "total": 1},
        }

        with patch(
            "app.api.routers.ai.migrate.ConfigMigrationService",
            return_value=service_mock,
        ):
            await migrate_module._run_migrate_job("job_2", payload, str(tmp_path))

    status = mock_storage.load_status("job_2")
    assert status is not None
    assert status["status"] == "completed"
    assert status["result"]["success"] is True
    assert status["iterations"] == 1


@pytest.mark.asyncio
async def test_progress_callback_respects_cancelled_status(payload, mock_storage, tmp_path):
    """进度回调发现状态为 cancelled 时，应调用 cancel 并不再覆盖为 running。"""
    from app.api.routers.ai import migrate as migrate_module
    from app.shared.services.llm.generation import CancelledError

    captured_callbacks = []

    async def slow_migrate(**kwargs):
        progress_callback = kwargs.get("progress_callback")
        captured_callbacks.append(progress_callback)
        # 模拟任务运行过程中被外部取消
        mock_storage.save_status("job_3", {"status": "cancelled"})
        if progress_callback:
            progress_callback("parse_script", 0.1, {})
        await asyncio.sleep(0)
        raise CancelledError()

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        service_mock = AsyncMock()
        service_mock.migrate_from_script.side_effect = slow_migrate
        service_mock.cancel = MagicMock()

        with patch(
            "app.api.routers.ai.migrate.ConfigMigrationService",
            return_value=service_mock,
        ):
            await migrate_module._run_migrate_job("job_3", payload, str(tmp_path))

    status = mock_storage.load_status("job_3")
    assert status is not None
    assert status["status"] == "cancelled"
    service_mock.cancel.assert_called_once()
