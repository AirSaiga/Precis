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
@fileoverview 确定性 Fake Provider（仅用于测试/演练，生产配置不应使用）

功能概述:
- 零网络、零 API Key 依赖的 Provider 实现，按请求内容回放固定剧本
- 让 AI 三大链路（agent 聊天写盘 / 配置生成 / 配置迁移）在 CI 无真实 key 时可确定性演练
- 剧本围绕同一目标设计：为 users.nickname 添加 chinese_mixed 字符集（Charset）约束

剧本选择（按 user 角色消息文本判定，见 _pick_scenario）:
1. 生成/迁移剧本: user 消息含生成提示词特征（"regex_nodes" 或（"输出要求" 且 "schemas"））
   或迁移特征（"迁移" 或 "V2 配置"）→ 返回固定配置 JSON 文本
   （schemas: users(id/name/nickname)；constraints: Charset(chinese_mixed) + NotNull(name)；
   manifest 由服务层 build_config 组装，此处不返回）
2. agent 聊天剧本（其余情况）:
   - 消息列表中尚无 role=="tool"（首轮）→ 返回 tool_calls 调用 apply_actions
     添加 Charset 约束（users.nickname，chinese_mixed，intent_scope 声明 users/nickname）
   - 已有 tool 消息（工具结果回灌后的下一轮）→ 返回纯文本总结（无 tool_calls，终止循环）

判定范围为何限定 user 角色消息: chat agent 的系统提示词同样含 "regex_nodes" 等字样
（chat_system_prompt.py 的项目概览段），全量拼接文本会把 agent 首轮误判为生成剧本，
导致 agent 永远不产生 tool_calls。生成/迁移链路的提示词恰好都是 user 角色（build_prompt 产物），
限定 user 消息既覆盖目标链路又避开该碰撞。

安全约束:
- fake 类型不出现在 provider presets（presets.py 不收录，UI 预设下拉不可见）
- 仅经 providers CRUD API 显式添加 type=fake 才会启用
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from .base import BaseProvider, ChatRequest, ChatResponse, StreamChunk

# FakeProvider 对外暴露的唯一模型 ID
FAKE_MODEL_ID = "fake-1"

# agent 聊天剧本的最终回复（第二轮纯文本，终止工具循环）
AGENT_FINAL_REPLY = "已为 users.nickname 创建 chinese_mixed 字符集约束。"

# 生成/迁移剧本返回的固定配置 JSON（V2 简化格式，由 build_config 归一化为标准 V2）
_GENERATION_CONFIG: dict[str, Any] = {
    "schemas": [
        {
            "id": "users",
            "name": "用户表",
            "columns": [
                {"id": "id", "name": "ID", "type": "integer", "primary_key": True, "nullable": False},
                {"id": "name", "name": "姓名", "type": "string"},
                {"id": "nickname", "name": "昵称", "type": "string"},
            ],
        }
    ],
    "constraints": [
        # Charset 走 V2 简化格式：table_id/column_id/charset_mode 平铺
        {"type": "Charset", "table_id": "users", "column_id": "nickname", "charset_mode": "chinese_mixed"},
        {"type": "NotNull", "table_id": "users", "column_id": "name"},
    ],
    "regex_nodes": [],
}

_GENERATION_JSON_TEXT = json.dumps(_GENERATION_CONFIG, ensure_ascii=False)

# agent 首轮 tool_calls：apply_actions 添加 Charset 约束（OpenAI tools 协议原始 dict 格式）
_APPLY_ACTIONS_ARGUMENTS = {
    "actions": [
        {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Charset",
                "tableName": "users",
                "targetColumn": "nickname",
                "params": {"charsetMode": "chinese_mixed"},
                "isInline": False,
            },
        }
    ],
    "intent_scope": {"tables": ["users"], "columns": [{"table": "users", "column": "nickname"}]},
}

_AGENT_TOOL_CALLS: list[dict[str, Any]] = [
    {
        "id": "call_fake_apply_1",
        "type": "function",
        "function": {
            "name": "apply_actions",
            "arguments": json.dumps(_APPLY_ACTIONS_ARGUMENTS, ensure_ascii=False),
        },
    }
]


def _user_text(req: ChatRequest) -> str:
    """拼接请求中所有 user 角色消息文本（剧本判定的输入）。"""
    return "\n".join(m.content or "" for m in req.messages if m.role == "user" and m.content)


def _has_tool_message(req: ChatRequest) -> bool:
    """请求中是否已有工具结果消息（agent 循环进入第二轮的标志）。"""
    return any(m.role == "tool" for m in req.messages)


def _is_generation_prompt(text: str) -> bool:
    """生成提示词特征：prompt_builder.build_prompt 产出的固定段落字样。"""
    return "regex_nodes" in text or ("输出要求" in text and "schemas" in text)


def _is_migration_prompt(text: str) -> bool:
    """迁移提示词特征：migrate_service 迁移任务/分片消息中的固定字样。"""
    return "迁移" in text or "V2 配置" in text


def _pick_scenario(req: ChatRequest) -> str:
    """按 user 消息文本选择剧本：generate / migrate / agent。"""
    text = _user_text(req)
    if _is_generation_prompt(text):
        return "generate"
    if _is_migration_prompt(text):
        return "migrate"
    return "agent"


class FakeProvider(BaseProvider):
    """
    @classdesc 确定性假 Provider（仅测试/演练）

    无网络、无 key 依赖，chat/chat_stream 按请求内容回放固定剧本：
    - 生成/迁移 → 固定配置 JSON 文本
    - agent 聊天首轮 → apply_actions tool_calls；第二轮 → 纯文本总结
    """

    @property
    def name(self) -> str:
        return "Fake (deterministic, test-only)"

    async def chat(self, req: ChatRequest) -> ChatResponse:
        """非流式对话：按剧本一次性返回。"""
        scenario = _pick_scenario(req)
        if scenario in ("generate", "migrate"):
            return ChatResponse(content=_GENERATION_JSON_TEXT, model=self._get_model(req.model))
        if _has_tool_message(req):
            return ChatResponse(content=AGENT_FINAL_REPLY, model=self._get_model(req.model))
        return ChatResponse(content=None, tool_calls=_AGENT_TOOL_CALLS, model=self._get_model(req.model))

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """流式对话：与 chat 同剧本。

        - 生成/迁移与 agent 收尾轮 → 分块 yield delta 文本
        - agent 首轮 → 一次性 yield type="tool_calls" 的完整工具调用集
        """
        scenario = _pick_scenario(req)
        if scenario in ("generate", "migrate"):
            yield StreamChunk(type="delta", text=_GENERATION_JSON_TEXT)
            return
        if _has_tool_message(req):
            # 拆成两个 delta 模拟真实流式输出形状
            mid = len(AGENT_FINAL_REPLY) // 2
            yield StreamChunk(type="delta", text=AGENT_FINAL_REPLY[:mid])
            yield StreamChunk(type="delta", text=AGENT_FINAL_REPLY[mid:])
            return
        yield StreamChunk(type="tool_calls", tool_calls=_AGENT_TOOL_CALLS)

    async def list_models(self) -> list[str]:
        return [FAKE_MODEL_ID]

    async def health(self) -> dict[str, Any]:
        return {"status": "ok", "latency_ms": 0, "provider": "fake"}
