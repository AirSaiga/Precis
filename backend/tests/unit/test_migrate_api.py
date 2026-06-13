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
from fastapi import HTTPException

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from app.api.routers.ai.models import ConfigMigrateRequest


def _job_status_data(**overrides: Any) -> dict[str, Any]:
    """构造满足 ConfigGenerateJobStatus 校验的最小状态数据。"""
    return {
        "job_id": "job_default",
        "status": "running",
        "stage": "initializing",
        "progress": 0.0,
        "iterations": 0,
        "max_iterations": 2,
        "created_at": "2024-01-01T00:00:00+00:00",
        "updated_at": "2024-01-01T00:00:00+00:00",
        "warnings": [],
        **overrides,
    }


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


@pytest.mark.asyncio
async def test_run_migrate_job_marks_cancelled_when_cancelled_error(payload, mock_storage, tmp_path):
    """迁移服务抛出 CancelledError 时，任务状态应为 cancelled。"""
    from app.api.routers.ai import migrate as migrate_module
    from app.shared.services.llm.generation import CancelledError

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        service_mock = AsyncMock()
        service_mock.migrate_from_script.side_effect = CancelledError()
        service_mock.cancel = MagicMock()

        with patch(
            "app.api.routers.ai.migrate.ConfigMigrationService",
            return_value=service_mock,
        ):
            await migrate_module._run_migrate_job("job_cancel", payload, str(tmp_path))

    status = mock_storage.load_status("job_cancel")
    assert status is not None
    assert status["status"] == "cancelled"
    assert status["stage"] == "cancelled"


@pytest.mark.asyncio
async def test_run_migrate_job_marks_failed_on_generation_parse_error(payload, mock_storage, tmp_path):
    """迁移服务抛出 GenerationParseError 时，任务状态应为 failed。"""
    from app.api.routers.ai import migrate as migrate_module
    from app.shared.services.llm.generation import GenerationParseError

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        service_mock = AsyncMock()
        service_mock.migrate_from_script.side_effect = GenerationParseError("parse failed")

        with patch(
            "app.api.routers.ai.migrate.ConfigMigrationService",
            return_value=service_mock,
        ):
            await migrate_module._run_migrate_job("job_parse", payload, str(tmp_path))

    status = mock_storage.load_status("job_parse")
    assert status is not None
    assert status["status"] == "failed"
    assert "parse failed" in status["error"]


@pytest.mark.asyncio
async def test_run_migrate_job_marks_failed_on_unexpected_exception(payload, mock_storage, tmp_path):
    """迁移服务抛出未知异常时，任务状态应为 failed。"""
    from app.api.routers.ai import migrate as migrate_module

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        service_mock = AsyncMock()
        service_mock.migrate_from_script.side_effect = RuntimeError("boom")

        with patch(
            "app.api.routers.ai.migrate.ConfigMigrationService",
            return_value=service_mock,
        ):
            await migrate_module._run_migrate_job("job_err", payload, str(tmp_path))

    status = mock_storage.load_status("job_err")
    assert status is not None
    assert status["status"] == "failed"
    assert status["error"] == "boom"


@pytest.mark.asyncio
async def test_create_migrate_job_creates_task_and_returns_job_id(payload, mock_storage, tmp_path, monkeypatch):
    """创建迁移任务应返回 job_id 并启动后台任务。"""
    from app.api.routers.ai import migrate as migrate_module

    created_tasks: list[Any] = []

    async def noop_coro():
        return None

    def fake_create_task(coro):
        # 关闭传入的真实协程，避免 coroutine was never awaited 警告，
        # 同时返回一个真实 Task 对象供后续取消测试使用。
        coro.close()
        task = asyncio.ensure_future(noop_coro())
        created_tasks.append(task)
        return task

    monkeypatch.setattr(asyncio, "create_task", fake_create_task)

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        response = await migrate_module.create_migrate_job(payload, str(tmp_path))

    assert response.job_id.startswith("job_migrate_")
    assert len(created_tasks) == 1
    assert mock_storage.load_status(response.job_id) is not None
    # 清理未完成的 task，避免事件循环警告
    for t in created_tasks:
        if not t.done():
            t.cancel()


@pytest.mark.asyncio
async def test_get_migrate_job_returns_status(payload, mock_storage, tmp_path):
    """获取存在的任务状态应返回对应状态对象。"""
    from app.api.routers.ai import migrate as migrate_module

    mock_storage.save_status("job_get", _job_status_data(job_id="job_get", status="running"))

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        status = await migrate_module.get_migrate_job("job_get", str(tmp_path))

    assert status.job_id == "job_get"
    assert status.status == "running"


@pytest.mark.asyncio
async def test_get_migrate_job_raises_404_when_missing(mock_storage, tmp_path):
    """获取不存在的任务状态应返回 404。"""
    from app.api.routers.ai import migrate as migrate_module

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        with pytest.raises(HTTPException) as exc_info:
            await migrate_module.get_migrate_job("job_missing", str(tmp_path))

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_cancel_migrate_job_cancels_running_task(payload, mock_storage, tmp_path, monkeypatch):
    """取消运行中的任务应更新状态并取消 asyncio Task。"""
    from app.api.routers.ai import migrate as migrate_module

    async def noop_coro():
        return None

    monkeypatch.setattr(
        asyncio,
        "create_task",
        lambda coro: coro.close() or asyncio.ensure_future(noop_coro()),
    )

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        create_response = await migrate_module.create_migrate_job(payload, str(tmp_path))
        # create_migrate_job 内部已把 task 放入 _job_tasks
        cancel_response = await migrate_module.cancel_migrate_job(create_response.job_id, str(tmp_path))

    assert cancel_response.status == "cancelled"


@pytest.mark.asyncio
async def test_cancel_migrate_job_returns_terminal_status(payload, mock_storage, tmp_path):
    """取消已完成/已失败/已取消的任务时直接返回当前状态。"""
    from app.api.routers.ai import migrate as migrate_module

    mock_storage.save_status(
        "job_done",
        _job_status_data(job_id="job_done", status="completed", stage="completed"),
    )

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        response = await migrate_module.cancel_migrate_job("job_done", str(tmp_path))

    assert response.status == "completed"


@pytest.mark.asyncio
async def test_cancel_migrate_job_raises_404_when_missing(mock_storage, tmp_path):
    """取消不存在的任务应返回 404。"""
    from app.api.routers.ai import migrate as migrate_module

    with patch.object(migrate_module, "_get_storage", return_value=mock_storage):
        with pytest.raises(HTTPException) as exc_info:
            await migrate_module.cancel_migrate_job("job_missing", str(tmp_path))

    assert exc_info.value.status_code == 404
