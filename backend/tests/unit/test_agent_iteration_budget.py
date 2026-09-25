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
"""@fileoverview Agent 工具调用预算（max_agent_iterations）配置化测试

覆盖：
- AIChatConfig 模型默认值与边界（ge=1 / le=50）
- 旧 yaml（无 chat 键）加载兼容、save/load round-trip 保留 chat 段
- ChatAgentRunner 预算解析优先级：显式传参 > 用户级配置 > 默认常量
- 预算耗尽 reminder 的自救指引（仅 chat agent 注入，生成 agent 不注入）
"""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import MagicMock

import pytest
import yaml
from pydantic import ValidationError

# 模块导入期持有真实解析函数引用：conftest 的 autouse 隔离桩只替换模块属性，
# 不影响本文件对真实 _resolve_max_agent_iterations 的直接调用
from app.shared.services.ai import chat_agent_runner as runner_mod
from app.shared.services.ai.agent.executor import AgentExecutor
from app.shared.services.ai.agent.tool_registry import ToolRegistry
from app.shared.services.ai.chat_agent_runner import ChatAgentRunner, _resolve_max_agent_iterations
from app.shared.services.llm.config.loader import ConfigLoader
from app.shared.services.llm.config.models import (
    DEFAULT_MAX_AGENT_ITERATIONS,
    AIChatConfig,
    AIConfig,
)
from app.shared.services.llm.providers.base import StreamChunk

# =============================================================================
# AIChatConfig 模型
# =============================================================================


class TestAIChatConfigModel:
    def test_default_matches_single_source_constant(self):
        """默认值 15 与单一来源常量一致，AIConfig 根对象整段取默认。"""
        assert DEFAULT_MAX_AGENT_ITERATIONS == 15
        assert AIChatConfig().max_agent_iterations == DEFAULT_MAX_AGENT_ITERATIONS
        assert AIConfig().chat.max_agent_iterations == DEFAULT_MAX_AGENT_ITERATIONS

    @pytest.mark.parametrize("value", [0, -1, 51, 100])
    def test_out_of_range_rejected(self, value):
        """超出 [1, 50] 边界的值被模型拒绝。"""
        with pytest.raises(ValidationError):
            AIChatConfig(max_agent_iterations=value)

    @pytest.mark.parametrize("value", [1, 50])
    def test_boundary_values_accepted(self, value):
        """边界值 1 与 50 合法。"""
        assert AIChatConfig(max_agent_iterations=value).max_agent_iterations == value


# =============================================================================
# 配置文件兼容与 round-trip
# =============================================================================


class TestChatSectionPersistence:
    def test_legacy_yaml_without_chat_key_loads_default(self, tmp_path):
        """旧配置（无 chat 键）加载兼容：chat 段整段取默认值。"""
        config_file = tmp_path / "ai_providers.yaml"
        config_file.write_text(yaml.dump({"version": "2.0", "providers": [], "defaults": {}}), encoding="utf-8")

        config = ConfigLoader(config_path=config_file).load()

        assert config.chat.max_agent_iterations == DEFAULT_MAX_AGENT_ITERATIONS

    def test_chat_section_survives_save_load_roundtrip(self, tmp_path):
        """save/load round-trip：chat 段落盘不丢、重读值一致。"""
        config_file = tmp_path / "ai_providers.yaml"
        loader = ConfigLoader(config_path=config_file)
        loader.load()  # 生成默认配置文件

        config = loader.load()
        config.chat.max_agent_iterations = 25
        loader.save(config)

        with open(config_file, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["chat"]["max_agent_iterations"] == 25

        assert ConfigLoader(config_path=config_file).load().chat.max_agent_iterations == 25


# =============================================================================
# 预算解析优先级（显式传参 > 用户级配置 > 默认常量）
# =============================================================================


class TestBudgetResolutionPriority:
    def test_chat_options_default_is_unspecified(self):
        """ChatOptions 缺省 max_agent_iterations 为 None（未显式指定）。"""
        from app.shared.services.ai.chat_orchestrator import ChatOptions

        assert ChatOptions().max_agent_iterations is None

    def test_explicit_param_wins_without_config_read(self, monkeypatch):
        """显式传参生效：不触发配置解析（runner 预算来自调用方）。"""
        spy = MagicMock(return_value=DEFAULT_MAX_AGENT_ITERATIONS)
        monkeypatch.setattr(runner_mod, "_resolve_max_agent_iterations", spy)

        runner = ChatAgentRunner(
            provider=MagicMock(),
            project_path="/fake/project",
            context_nodes=[],
            max_iterations=7,
        )

        assert runner.max_iterations == 7
        spy.assert_not_called()

    def test_unspecified_reads_config_backoff(self, monkeypatch):
        """未显式指定（None）：runner 经统一解析点读用户级配置。"""
        monkeypatch.setattr(runner_mod, "_resolve_max_agent_iterations", lambda: 25)

        runner = ChatAgentRunner(provider=MagicMock(), project_path="/fake/project", context_nodes=[])

        assert runner.max_iterations == 25

    def test_resolver_reads_chat_section_from_user_config(self, monkeypatch):
        """解析点读 ~/.precis/ai_providers.yaml 的 chat.max_agent_iterations。"""
        monkeypatch.setattr(
            ConfigLoader,
            "load",
            lambda self: AIConfig(chat=AIChatConfig(max_agent_iterations=25)),
        )

        assert _resolve_max_agent_iterations() == 25

    def test_resolver_falls_back_to_constant_on_config_failure(self, monkeypatch, caplog):
        """配置损坏（load 抛异常）不崩聊天：告警并回退默认常量。"""

        def _raise(self):
            raise ValueError("Unsupported config version: 1.0, expected 2.x")

        monkeypatch.setattr(ConfigLoader, "load", _raise)

        with caplog.at_level(logging.WARNING):
            assert _resolve_max_agent_iterations() == DEFAULT_MAX_AGENT_ITERATIONS

        assert "chat.max_agent_iterations" in caplog.text

    def test_agent_executor_default_uses_single_source_constant(self):
        """AgentExecutor 缺省预算引用同一常量，无散落字面量。"""
        executor = AgentExecutor(provider=MagicMock(), registry=MagicMock())

        assert executor.max_iterations == DEFAULT_MAX_AGENT_ITERATIONS


# =============================================================================
# 预算耗尽 reminder 的自救指引
# =============================================================================


class _ScriptedStreamProvider:
    """最小流式 Provider 桩：按剧本返回 tool_calls，记录每轮请求的 messages。"""

    def __init__(self, responses: list[dict[str, Any]]):
        self.responses = responses
        self.call_index = 0
        self.all_messages: list[list[Any]] = []

    async def chat_stream(self, req: Any):
        self.all_messages.append(list(req.messages))
        response = self.responses[self.call_index]
        self.call_index += 1
        tool_calls = response.get("tool_calls")
        if tool_calls:
            yield StreamChunk(type="tool_calls", tool_calls=tool_calls)


def _make_noop_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        name="noop",
        description="Noop",
        parameters={"type": "object", "properties": {}},
        handler=lambda args: {"success": True},
    )
    return registry


def _last_turn_user_texts(provider: _ScriptedStreamProvider) -> list[str]:
    return [(m.content or "") for m in provider.all_messages[-1] if m.role == "user"]


class TestBudgetExhaustedReminder:
    @pytest.mark.asyncio
    async def test_chat_agent_reminder_includes_config_hint(self):
        """chat agent（无最终输出工具）预算耗尽：reminder 附带调大配置的自救指引。"""
        provider = _ScriptedStreamProvider(
            responses=[
                {"tool_calls": [{"id": "c1", "type": "function", "function": {"name": "noop", "arguments": "{}"}}]},
                {"tool_calls": [{"id": "c2", "type": "function", "function": {"name": "noop", "arguments": "{}"}}]},
            ]
        )
        executor = AgentExecutor(
            provider=provider,
            registry=_make_noop_registry(),
            max_iterations=2,
            final_output_tool=None,
        )
        await executor.run("test")

        texts = _last_turn_user_texts(provider)
        assert any("工具调用预算" in t for t in texts), "最后一轮应注入收敛 reminder"
        assert any("chat.max_agent_iterations" in t for t in texts), "chat agent 应附带配置自救指引"

    @pytest.mark.asyncio
    async def test_generation_agent_reminder_excludes_chat_hint(self):
        """生成/迁移 agent（有最终输出工具）预算耗尽：不注入 chat 配置指引（预算来源不同）。"""
        provider = _ScriptedStreamProvider(
            responses=[
                {"tool_calls": [{"id": "c1", "type": "function", "function": {"name": "noop", "arguments": "{}"}}]},
                {"tool_calls": [{"id": "c2", "type": "function", "function": {"name": "noop", "arguments": "{}"}}]},
            ]
        )
        executor = AgentExecutor(provider=provider, registry=_make_noop_registry(), max_iterations=2)
        await executor.run("test")

        texts = _last_turn_user_texts(provider)
        assert any("工具调用预算" in t for t in texts), "最后一轮应注入收敛 reminder"
        assert not any("chat.max_agent_iterations" in t for t in texts), "生成 agent 不应附带 chat 配置指引"
