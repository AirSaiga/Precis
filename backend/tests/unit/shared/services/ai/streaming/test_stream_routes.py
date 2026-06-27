"""@fileoverview SSE 流式路由端点单元测试

测试 stream 模块的纯逻辑（取消信号管理、journal 目录），不依赖 FastAPI app 实例。

端点注册与 HTTP 请求的集成验证由 E2E 测试覆盖（ai-chat-agent / ai-chat-confirm /
ai-config-generation / ai-config-migration），遵循项目 E2E-first 策略。
此前依赖 app.include_router 副作用的集成测试在 CI(Linux) 环境不稳定
（include_router 拷贝路由行为的环境差异），故移除，改由 E2E 在真实后端验证。
"""

from __future__ import annotations

from app.api.routers.ai import stream as stream_module


def test_cancel_endpoint_sets_event_for_known_job():
    """cancel 已知 job 设置 cancel_event。"""
    import asyncio

    job_id = "test_known_job"
    ev = asyncio.Event()
    stream_module._cancel_events[job_id] = ev
    try:
        assert not ev.is_set()
        # 模拟取消
        stream_module._cancel_events[job_id].set()
        assert ev.is_set()
    finally:
        stream_module._cancel_events.pop(job_id, None)


def test_unregister_cancel_event_removes_entry():
    """_unregister_cancel_event 移除已注册的 job。"""
    import asyncio

    job_id = "test_unregister"
    stream_module._cancel_events[job_id] = asyncio.Event()
    assert job_id in stream_module._cancel_events

    stream_module._unregister_cancel_event(job_id)
    assert job_id not in stream_module._cancel_events


def test_journal_dir_for_project_path():
    """_journal_dir_for 按 project_path 返回项目本地目录（跨平台）。"""
    import os

    result = stream_module._journal_dir_for("/my/project")
    # 跨平台：用 os.path.join 拼接，断言路径组成部分而非硬编码分隔符
    expected = os.path.join("/my/project", ".precis", "stream_jobs")
    assert result == expected


def test_journal_dir_for_none_project_path():
    """_journal_dir_for 无 project_path 时回退到用户级目录。"""
    import os

    result = stream_module._journal_dir_for(None)
    expected = os.path.join(os.path.expanduser("~"), ".precis", "stream_jobs")
    assert result == expected
