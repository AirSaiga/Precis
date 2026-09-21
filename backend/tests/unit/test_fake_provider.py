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
"""
@fileoverview FakeProvider 单元测试

覆盖确定性剧本的三个维度：
- 剧本选择：生成 / 迁移 / agent 两轮（用真实 build_prompt 与 CHAT_AGENT_SYSTEM_PROMPT 做回归守卫，
  防止提示词改版后剧本误判）
- tool_calls 格式：OpenAI tools 协议原始 dict（apply_actions + ADD_CONSTRAINT_NODE + intent_scope）
- chat_stream 形状：StreamChunk 的 type/text/tool_calls 契约
"""

from __future__ import annotations

import json

import pytest

from app.shared.services.ai.chat_agent_runner import CHAT_AGENT_SYSTEM_PROMPT
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.generation.prompt_builder import build_prompt
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest
from app.shared.services.llm.providers.fake import AGENT_FINAL_REPLY, FAKE_MODEL_ID, FakeProvider
from app.shared.services.llm.providers.registry import create

# 模拟 profiler 输出的最小画像数据（users 表含 nickname 列）
_PROFILING_DATA = [
    {
        "table_name": "users",
        "path": "data/users.csv",
        "columns": [
            {"name": "id", "dtype": "int64", "null_count": 0, "sample_values": [1, 2]},
            {"name": "name", "dtype": "object", "null_count": 0, "sample_values": ["张三", "李四"]},
            {"name": "nickname", "dtype": "object", "null_count": 0, "sample_values": ["小明", "Tom2"]},
        ],
    }
]


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider(
        AIProvider(
            id="fake-e2e",
            name="fake-e2e",
            type=ProviderType.FAKE,
            base_url="http://localhost/fake",
            model=FAKE_MODEL_ID,
        )
    )


def _generation_req() -> ChatRequest:
    """构造生成链路真实形状的请求：system + build_prompt 产出的 user 消息。"""
    prompt, _ = build_prompt(_PROFILING_DATA, "e2e-fake-project")
    return ChatRequest(
        messages=[
            ChatMessage(role="system", content="你是一个数据治理专家，擅长分析数据文件并生成数据验证配置。"),
            ChatMessage(role="user", content=prompt),
        ],
        temperature=0.3,
    )


def _agent_req(turn: int) -> ChatRequest:
    """构造 agent 聊天链路真实形状的请求。

    turn=1：system（真实 CHAT_AGENT_SYSTEM_PROMPT）+ 用户消息；
    turn=2：追加 assistant(tool_calls) 与 tool 结果消息（executor 回灌后的形状）。
    """
    messages = [
        ChatMessage(role="system", content=CHAT_AGENT_SYSTEM_PROMPT),
        ChatMessage(role="user", content="为 users 表 nickname 列加中文混合字符集约束"),
    ]
    if turn >= 2:
        messages.append(
            ChatMessage(
                role="assistant",
                content=None,
                tool_calls=[
                    {
                        "id": "call_fake_apply_1",
                        "type": "function",
                        "function": {"name": "apply_actions", "arguments": "{}"},
                    }
                ],
            )
        )
        messages.append(ChatMessage(role="tool", content='{"success": true}', tool_call_id="call_fake_apply_1"))
    return ChatRequest(messages=messages, temperature=0.3, tools=[{"type": "function"}], tool_choice="auto")


class TestScenarioSelection:
    @pytest.mark.asyncio
    async def test_generation_prompt_returns_config_json(self, provider: FakeProvider):
        resp = await provider.chat(_generation_req())
        assert resp.tool_calls is None
        parsed = json.loads(resp.content or "")
        assert [s["id"] for s in parsed["schemas"]] == ["users"]
        columns = {c["id"] for c in parsed["schemas"][0]["columns"]}
        assert columns == {"id", "name", "nickname"}
        constraint_types = {c["type"] for c in parsed["constraints"]}
        assert constraint_types == {"Charset", "NotNull"}

    @pytest.mark.asyncio
    async def test_generation_config_contains_chinese_mixed_charset(self, provider: FakeProvider):
        resp = await provider.chat(_generation_req())
        parsed = json.loads(resp.content or "")
        charset = next(c for c in parsed["constraints"] if c["type"] == "Charset")
        assert charset["table_id"] == "users"
        assert charset["column_id"] == "nickname"
        assert charset["charset_mode"] == "chinese_mixed"

    @pytest.mark.asyncio
    async def test_migration_prompt_returns_same_config(self, provider: FakeProvider):
        req = ChatRequest(
            messages=[
                ChatMessage(role="system", content="你是一个数据治理专家 Agent。"),
                ChatMessage(role="user", content="从以下旧脚本迁移生成 Precis V2 数据验证配置。"),
            ]
        )
        resp = await provider.chat(req)
        parsed = json.loads(resp.content or "")
        assert [s["id"] for s in parsed["schemas"]] == ["users"]

    @pytest.mark.asyncio
    async def test_agent_first_turn_uses_real_chat_system_prompt(self, provider: FakeProvider):
        """回归守卫：真实 chat agent 系统提示词含 "regex_nodes" 字样，不得误判为生成剧本。"""
        resp = await provider.chat(_agent_req(turn=1))
        assert resp.tool_calls is not None, (
            "agent 首轮必须返回 tool_calls（系统提示词含 regex_nodes 不得误判为生成剧本）"
        )
        assert not resp.content

    @pytest.mark.asyncio
    async def test_agent_second_turn_returns_final_text(self, provider: FakeProvider):
        resp = await provider.chat(_agent_req(turn=2))
        assert resp.tool_calls is None
        assert "字符集" in (resp.content or "")
        assert "chinese_mixed" in (resp.content or "")


class TestToolCallsFormat:
    @pytest.mark.asyncio
    async def test_openai_protocol_shape(self, provider: FakeProvider):
        resp = await provider.chat(_agent_req(turn=1))
        assert resp.tool_calls is not None
        assert len(resp.tool_calls) == 1
        tc = resp.tool_calls[0]
        assert tc["type"] == "function"
        assert tc["id"]
        assert tc["function"]["name"] == "apply_actions"

    @pytest.mark.asyncio
    async def test_apply_actions_arguments(self, provider: FakeProvider):
        resp = await provider.chat(_agent_req(turn=1))
        tc = resp.tool_calls[0]  # type: ignore[index]
        args = json.loads(tc["function"]["arguments"])
        assert len(args["actions"]) == 1
        action = args["actions"][0]
        assert action["actionType"] == "ADD_CONSTRAINT_NODE"
        spec = action["constraintSpec"]
        assert spec["type"] == "Charset"
        assert spec["tableName"] == "users"
        assert spec["targetColumn"] == "nickname"
        assert spec["params"] == {"charsetMode": "chinese_mixed"}
        assert spec["isInline"] is False
        assert args["intent_scope"] == {
            "tables": ["users"],
            "columns": [{"table": "users", "column": "nickname"}],
        }


class TestChatStreamShape:
    @pytest.mark.asyncio
    async def test_generation_stream_yields_delta_json(self, provider: FakeProvider):
        chunks = [c async for c in provider.chat_stream(_generation_req())]
        assert chunks
        assert all(c.type == "delta" for c in chunks)
        text = "".join(c.text or "" for c in chunks)
        parsed = json.loads(text)
        assert parsed["schemas"][0]["id"] == "users"

    @pytest.mark.asyncio
    async def test_agent_first_turn_stream_yields_tool_calls_chunk(self, provider: FakeProvider):
        chunks = [c async for c in provider.chat_stream(_agent_req(turn=1))]
        assert len(chunks) == 1
        chunk = chunks[0]
        assert chunk.type == "tool_calls"
        assert chunk.text is None
        assert chunk.tool_calls is not None
        assert chunk.tool_calls[0]["function"]["name"] == "apply_actions"

    @pytest.mark.asyncio
    async def test_agent_second_turn_stream_concatenates_to_reply(self, provider: FakeProvider):
        chunks = [c async for c in provider.chat_stream(_agent_req(turn=2))]
        assert chunks
        assert all(c.type == "delta" for c in chunks)
        assert "".join(c.text or "" for c in chunks) == AGENT_FINAL_REPLY


class TestProviderMetadata:
    def test_registry_creates_fake_provider(self):
        config = AIProvider(
            id="fake-e2e",
            name="fake-e2e",
            type=ProviderType.FAKE,
            base_url="http://localhost/fake",
            model=FAKE_MODEL_ID,
        )
        created = create(config)
        assert isinstance(created, FakeProvider)

    def test_provider_type_enum_value(self):
        assert ProviderType.FAKE.value == "fake"
        assert ProviderType("fake") is ProviderType.FAKE

    @pytest.mark.asyncio
    async def test_list_models(self, provider: FakeProvider):
        assert await provider.list_models() == ["fake-1"]

    @pytest.mark.asyncio
    async def test_health_is_ok(self, provider: FakeProvider):
        health = await provider.health()
        assert health["status"] == "ok"

    def test_display_name_marks_test_only(self, provider: FakeProvider):
        assert "test-only" in provider.name
