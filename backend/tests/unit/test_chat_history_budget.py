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
"""聊天历史预算自适应推导测试

覆盖 P1 修复"聊天路径不探测上下文窗口"：
- resolve_chat_history_budget 纯函数：小窗口收缩 / 大窗口封顶 / 探测异常回退
- ChatAgentRunner（agent 路径）缺省预算时从 provider 窗口推导；显式预算不被覆盖
- AIChatOrchestrator（legacy 路径）缺省预算时同一来源推导；探测失败回退默认

两处路径共用 resolve_chat_history_budget，保证预算来源一致。
"""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import patch

import pytest

from app.shared.services.ai.chat_agent_runner import ChatAgentRunner
from app.shared.services.ai.chat_orchestrator import AIChatOrchestrator, ChatOptions
from app.shared.services.ai.utils import (
    _DEFAULT_TOOL_DEFINITIONS_TOKENS,
    _MIN_HISTORY_BUDGET,
    CHAT_HISTORY_BUDGET_CAP,
    estimate_tokens,
    resolve_chat_history_budget,
)
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers.base import BaseProvider, ChatRequest, ChatResponse, StreamChunk


class _WindowFakeProvider(BaseProvider):
    """带可配置上下文窗口的假 Provider，记录探测次数。"""

    def __init__(self, context_window: int | None = None, raise_on_probe: bool = False):
        super().__init__(
            AIProvider(
                id="fake",
                name="Fake",
                type=ProviderType.OPENAI,
                base_url="http://localhost",
                api_key="",
                model="fake",
            )
        )
        self._context_window = context_window
        self._raise_on_probe = raise_on_probe
        self.probe_count = 0

    @property
    def name(self):
        return "Fake"

    def get_context_window(self, model: str | None = None) -> int:
        self.probe_count += 1
        if self._raise_on_probe:
            raise RuntimeError("窗口探测网络失败")
        if self._context_window is not None:
            return self._context_window
        return super().get_context_window(model)

    async def chat(self, req: ChatRequest) -> ChatResponse:
        return ChatResponse(content='{"reply": "ok", "actions": []}', model="fake")

    async def chat_stream(self, req: ChatRequest):  # pragma: no cover - 本测试不消费流
        yield StreamChunk(type="delta", text="")

    async def list_models(self) -> list[str]:
        return ["fake"]

    async def health(self) -> dict[str, str]:
        return {"status": "ok"}


# compute_token_budgets(16384) = (11776, 4096)：输入预算 = 窗口 - 输出 - 余量
_SMALL_WINDOW = 16384
_SMALL_WINDOW_BUDGET = 11776
# 极端小窗：compute_token_budgets(4096) = (2560, 1024)，扣除工具预留后触发保底
_TINY_WINDOW = 4096
_EMPTY_OVERVIEW = {"schemas": [], "constraints": [], "transforms": [], "regex_nodes": [], "settings": {}}


# =============================================================================
# resolve_chat_history_budget 纯函数
# =============================================================================


@pytest.mark.asyncio
async def test_small_context_window_shrinks_budget():
    """小窗口（16k）→ 预算按窗口收缩（窗口 - 输出预留 - 余量），小于默认上限。

    传 tool_definitions_tokens=0 隔离窗口收缩语义（工具预留另测）。
    """
    budget = await resolve_chat_history_budget(_WindowFakeProvider(_SMALL_WINDOW), tool_definitions_tokens=0)

    assert budget == _SMALL_WINDOW_BUDGET
    assert budget < CHAT_HISTORY_BUDGET_CAP


@pytest.mark.asyncio
async def test_large_context_window_capped_at_hardcoded_limit():
    """大窗口 → 预算不超过硬编码上限（与旧版默认一致，不放大行为）。"""
    budget = await resolve_chat_history_budget(_WindowFakeProvider(10_000_000), tool_definitions_tokens=0)

    assert budget == CHAT_HISTORY_BUDGET_CAP


@pytest.mark.asyncio
async def test_probe_failure_falls_back_to_default():
    """探测抛异常 → 回退现状默认值（120000），不向上传播。"""
    budget = await resolve_chat_history_budget(_WindowFakeProvider(raise_on_probe=True))

    assert budget == CHAT_HISTORY_BUDGET_CAP


@pytest.mark.asyncio
async def test_provider_without_probe_support_falls_back_to_default():
    """provider 不提供 get_context_window → 同样回退默认值。"""
    budget = await resolve_chat_history_budget(object())

    assert budget == CHAT_HISTORY_BUDGET_CAP


# =============================================================================
# 工具定义 token 预留（P1 审查修复：预算须覆盖系统提示词+工具定义+历史）
# =============================================================================


@pytest.mark.asyncio
async def test_tool_definition_tokens_deducted_from_budget():
    """显式传入工具定义估算 → 从输入预算扣除后再作为历史预算。"""
    budget = await resolve_chat_history_budget(_WindowFakeProvider(_SMALL_WINDOW), tool_definitions_tokens=3500)

    assert budget == _SMALL_WINDOW_BUDGET - 3500


@pytest.mark.asyncio
async def test_default_constant_reserved_when_unspecified():
    """未传入估算 → 按保守常量预留（宁可少算历史，不可挤爆窗口）。"""
    budget = await resolve_chat_history_budget(_WindowFakeProvider(_SMALL_WINDOW))

    assert budget == _SMALL_WINDOW_BUDGET - _DEFAULT_TOOL_DEFINITIONS_TOKENS


@pytest.mark.asyncio
async def test_zero_tools_keeps_full_input_budget():
    """无工具路径（legacy 纯文本）显式传 0 → 不做工具预留。"""
    budget = await resolve_chat_history_budget(_WindowFakeProvider(_SMALL_WINDOW), tool_definitions_tokens=0)

    assert budget == _SMALL_WINDOW_BUDGET


@pytest.mark.asyncio
async def test_tiny_window_floors_budget_with_warning(caplog):
    """极端小窗：输入预算扣除工具预留后低于保底 → 按保底继续并告警（不抛错）。"""
    # compute_token_budgets(4096) = (2560, 1024)；2560 - 默认工具预留 < 保底 2048
    with caplog.at_level(logging.WARNING, logger="app.shared.services.ai.utils"):
        budget = await resolve_chat_history_budget(_WindowFakeProvider(_TINY_WINDOW))

    assert budget == _MIN_HISTORY_BUDGET
    # 告警须点明"系统提示词+工具定义已接近或超出窗口"的处置建议
    assert any("上下文窗口过小" in r.message and "工具集" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_floor_not_triggered_when_budget_sufficient(caplog):
    """常规窗口扣除工具预留后仍充裕 → 不触发保底告警。"""
    with caplog.at_level(logging.WARNING, logger="app.shared.services.ai.utils"):
        budget = await resolve_chat_history_budget(_WindowFakeProvider(_SMALL_WINDOW), tool_definitions_tokens=3500)

    assert budget == _SMALL_WINDOW_BUDGET - 3500
    assert not any("上下文窗口过小" in r.message for r in caplog.records)


# =============================================================================
# ChatAgentRunner（agent 路径）预算接线
# =============================================================================


class _CapturingExecutor:
    """捕获构造参数并直接返回成功的 AgentResult，不跑真实循环。"""

    instances: list[_CapturingExecutor] = []

    def __init__(self, **kwargs: Any):
        self.kwargs = kwargs
        _CapturingExecutor.instances.append(self)

    async def run(self, task_message: str, initial_checkpoint: dict | None = None):
        from app.shared.services.ai.agent.types import AgentResult

        return AgentResult(success=True, content="done", iterations=1)


@pytest.fixture
def _fresh_capturing_executor():
    _CapturingExecutor.instances = []
    yield
    _CapturingExecutor.instances = []


@pytest.mark.asyncio
async def test_runner_derives_budget_from_provider_window(_fresh_capturing_executor):
    """runner 缺省预算（None）→ 按 provider 窗口推导并扣除工具定义估算后传给 AgentExecutor。"""
    provider = _WindowFakeProvider(_SMALL_WINDOW)
    runner = ChatAgentRunner(provider=provider, project_path="/fake/project", context_nodes=[])

    with patch("app.shared.services.ai.chat_agent_runner.AgentExecutor", _CapturingExecutor):
        await runner.run("hi")

    assert provider.probe_count == 1, "缺省预算时应探测一次上下文窗口"
    # agent 路径按 registry.get_definitions() 序列化估算扣除工具定义 token
    # （estimate_tokens 对 JSON 标点逐字符计数，天然偏保守）
    probe = ChatAgentRunner(provider=provider, project_path="/fake/project", context_nodes=[])
    tools_estimate = estimate_tokens(json.dumps(probe._create_registry().get_definitions(), ensure_ascii=False))
    assert _CapturingExecutor.instances[0].kwargs["max_tokens"] == _SMALL_WINDOW_BUDGET - tools_estimate
    assert tools_estimate > 0, "chat 工具集非空，估算应为正"


@pytest.mark.asyncio
async def test_runner_explicit_budget_wins_without_probing(_fresh_capturing_executor):
    """runner 显式预算（CLI 已按窗口算好）→ 直接使用，不重复探测。"""
    provider = _WindowFakeProvider(_SMALL_WINDOW)
    runner = ChatAgentRunner(
        provider=provider,
        project_path="/fake/project",
        context_nodes=[],
        max_history_tokens=555,
    )

    with patch("app.shared.services.ai.chat_agent_runner.AgentExecutor", _CapturingExecutor):
        await runner.run("hi")

    assert provider.probe_count == 0, "显式预算时不应探测"
    assert _CapturingExecutor.instances[0].kwargs["max_tokens"] == 555


# =============================================================================
# AIChatOrchestrator（legacy 路径）预算接线
# =============================================================================


async def _run_legacy_chat(orchestrator_provider: BaseProvider, llm_provider: Any) -> dict[str, Any]:
    """跑一次 legacy 路径（agent_mode=False），捕获 truncate_history_by_tokens 收到的预算。"""
    orchestrator = AIChatOrchestrator(provider=orchestrator_provider.cfg)
    captured: dict[str, Any] = {}

    def _capture_truncate(history, system_prompt, max_tokens=120000):  # noqa: ARG001
        captured["max_tokens"] = max_tokens
        return history

    with (
        patch("app.shared.services.llm.providers.create", return_value=llm_provider),
        patch("app.shared.services.ai.utils.truncate_history_by_tokens", side_effect=_capture_truncate),
        patch("app.shared.services.ai.utils.get_project_overview", return_value=_EMPTY_OVERVIEW),
    ):
        result = await orchestrator.execute_chat(
            message="hi",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(agent_mode=False, history=[{"role": "user", "content": "早"}]),
        )

    captured["success"] = result.success
    return captured


@pytest.mark.asyncio
async def test_orchestrator_legacy_derives_budget_from_provider_window():
    """legacy 路径缺省预算 → 与 agent 路径同源推导（小窗口收缩）。"""
    captured = await _run_legacy_chat(
        orchestrator_provider=_WindowFakeProvider(_SMALL_WINDOW),
        llm_provider=_WindowFakeProvider(_SMALL_WINDOW),
    )

    assert captured["success"] is True
    assert captured["max_tokens"] == _SMALL_WINDOW_BUDGET


@pytest.mark.asyncio
async def test_orchestrator_legacy_probe_failure_falls_back():
    """legacy 路径探测失败（create 出的 provider 无 get_context_window）→ 回退默认预算。"""

    class _NoProbeProvider:
        async def chat(self, req):  # noqa: ARG001
            return ChatResponse(content='{"reply": "ok", "actions": []}', model="fake")

    captured = await _run_legacy_chat(
        orchestrator_provider=_WindowFakeProvider(_SMALL_WINDOW),
        llm_provider=_NoProbeProvider(),
    )

    assert captured["success"] is True
    assert captured["max_tokens"] == CHAT_HISTORY_BUDGET_CAP


@pytest.mark.asyncio
async def test_orchestrator_legacy_explicit_budget_respected():
    """legacy 路径显式预算（CLI 传入）→ 不被推导覆盖。"""
    orchestrator = AIChatOrchestrator(provider=_WindowFakeProvider(_SMALL_WINDOW).cfg)
    captured: dict[str, Any] = {}

    def _capture_truncate(history, system_prompt, max_tokens=120000):  # noqa: ARG001
        captured["max_tokens"] = max_tokens
        return history

    with (
        patch("app.shared.services.llm.providers.create", return_value=_WindowFakeProvider(_SMALL_WINDOW)),
        patch("app.shared.services.ai.utils.truncate_history_by_tokens", side_effect=_capture_truncate),
        patch("app.shared.services.ai.utils.get_project_overview", return_value=_EMPTY_OVERVIEW),
    ):
        result = await orchestrator.execute_chat(
            message="hi",
            project_path="/fake/project",
            context_nodes=[],
            options=ChatOptions(
                agent_mode=False,
                history=[{"role": "user", "content": "早"}],
                max_history_tokens=777,
            ),
        )

    assert result.success is True
    assert captured["max_tokens"] == 777
