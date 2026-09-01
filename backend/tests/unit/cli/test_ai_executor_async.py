"""@fileoverview execute_ai_chat 异步执行方式单元测试

回归：executor.py 此前用已弃用的 asyncio.get_event_loop + run_until_complete，
且新建的 loop 从不 close（循环泄漏）；use_streaming 为从未被函数体读取的死参数。
修复后统一 asyncio.run 驱动，死参数删除。
"""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, MagicMock, patch

from app.cli.shell.commands.ai import executor as executor_mod
from app.cli.shell.commands.ai.executor import execute_ai_chat
from app.cli.shell.commands.base import ProjectContext


def _fake_result():
    r = MagicMock()
    r.success = True
    r.reply = "好的，已完成"
    r.actions = []
    r.frontend_instructions = None
    r.tool_steps = []
    return r


def _make_context(tmp_path) -> ProjectContext:
    ctx = ProjectContext()
    ctx.project_path = str(tmp_path)
    ctx.project_config = {"project": {"name": "P", "id": "p"}}
    return ctx


def _orchestrator_patches(orch_cls_mock):
    """屏蔽 provider 配置与上下文构建等外部边界。"""
    return [
        patch.object(executor_mod, "_get_provider_display", return_value={"id": "x"}),
        patch.object(executor_mod, "_get_provider_with_key", return_value={"id": "x", "api_key": "k"}),
        patch.object(executor_mod, "resolve_context_window", return_value=8000),
        patch.object(executor_mod, "AIChatOrchestrator", orch_cls_mock),
        patch(
            "app.cli.shell.commands.ai.interaction.build_context_data",
            return_value={"context": {"selectedNodes": []}},
        ),
    ]


class TestExecuteAIChatAsync:
    def test_signature_dropped_dead_use_streaming(self):
        """死参数 use_streaming 已从签名删除。"""
        params = inspect.signature(execute_ai_chat).parameters
        assert "use_streaming" not in params

    def test_drives_coroutine_via_asyncio_run(self, tmp_path):
        """执行路径走 asyncio.run（一次性事件循环，用后关闭）。"""
        fake_result = _fake_result()
        orch_cls = MagicMock()
        # asyncio.run 被 mock，协程不会被真实驱动，execute_chat 用普通 MagicMock 即可
        # （避免 AsyncMock 产生 never-awaited 协程告警）
        orch_cls.return_value.execute_chat = MagicMock(return_value=fake_result)

        patches = _orchestrator_patches(orch_cls)
        with patch("asyncio.run", return_value=fake_result) as mock_asyncio_run:
            for p in patches:
                p.start()
            try:
                result = execute_ai_chat("帮我加个约束", _make_context(tmp_path))
            finally:
                for p in patches:
                    p.stop()

        mock_asyncio_run.assert_called_once()
        assert result.success
        assert result.data["reply"] == "好的，已完成"

    def test_real_loop_drives_orchestrator_coroutine(self, tmp_path):
        """不 mock asyncio.run：真实事件循环驱动 orchestrator 协程并返回结果。"""
        fake_result = _fake_result()
        orch_cls = MagicMock()
        orch_cls.return_value.execute_chat = AsyncMock(return_value=fake_result)

        patches = _orchestrator_patches(orch_cls)
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("帮我加个约束", _make_context(tmp_path))
        finally:
            for p in patches:
                p.stop()

        assert result.success
        assert result.data["reply"] == "好的，已完成"
        orch_cls.return_value.execute_chat.assert_awaited_once()
