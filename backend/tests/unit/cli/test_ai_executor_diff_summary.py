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
"""@fileoverview execute_ai_chat 事后 diff 摘要触发条件测试

回归：agent 模式整轮结束后不再弹"📋 修改文件摘要 + 查看详细 diff?"——
该摘要的数据源是会话前快照（漏掉本会话新建的文件），且 input() 会吞掉用户
的下一条命令；agent 路径的两阶段确认框已具备完整 dry-run diff 能力。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from app.cli.shell.commands.ai import executor as executor_mod
from app.cli.shell.commands.ai.executor import execute_ai_chat
from app.cli.shell.commands.base import ProjectContext


def _fake_result():
    r = MagicMock()
    r.success = True
    r.reply = "好的，已完成"
    r.actions = [{"actionType": "ADD_CONSTRAINT_NODE", "constraintSpec": {"type": "NotNull"}}]
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


class TestPostExecutionDiffSummaryTrigger:
    def test_agent_mode_skips_post_execution_summary(self, tmp_path):
        """agent 模式（默认）：交互 + 有 actions 也不触发事后摘要与会话前快照收集。"""
        fake_result = _fake_result()
        orch_cls = MagicMock()
        orch_cls.return_value.execute_chat = AsyncMock(return_value=fake_result)

        display_mock = MagicMock()
        collect_mock = MagicMock(return_value={})
        patches = _orchestrator_patches(orch_cls) + [
            patch.object(executor_mod, "_display_execution_results", display_mock),
            patch.object(executor_mod, "_collect_all_config_files", collect_mock),
        ]
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("帮我加个约束", _make_context(tmp_path), interactive=True, agent_mode=True)
        finally:
            for p in patches:
                p.stop()

        assert result.success
        display_mock.assert_not_called()
        collect_mock.assert_not_called()

    def test_legacy_mode_shows_post_execution_summary(self, tmp_path):
        """legacy 模式（agent_mode=False）：交互 + 有 actions 时照常弹事后摘要。"""
        fake_result = _fake_result()
        orch_cls = MagicMock()
        orch_cls.return_value.execute_chat = AsyncMock(return_value=fake_result)

        display_mock = MagicMock()
        collect_mock = MagicMock(return_value={})
        patches = _orchestrator_patches(orch_cls) + [
            patch.object(executor_mod, "_display_execution_results", display_mock),
            patch.object(executor_mod, "_collect_all_config_files", collect_mock),
        ]
        for p in patches:
            p.start()
        try:
            result = execute_ai_chat("帮我加个约束", _make_context(tmp_path), interactive=True, agent_mode=False)
        finally:
            for p in patches:
                p.stop()

        assert result.success
        collect_mock.assert_called_once_with(str(tmp_path))
        display_mock.assert_called_once_with(fake_result, str(tmp_path), {})
