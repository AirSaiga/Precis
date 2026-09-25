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
"""@fileoverview Agent 记忆模块

功能概述:
- 管理 Agent 多轮对话的上下文
- 按 token 预算截断历史，保留 system prompt 和最近轮次
- 支持保存和恢复 checkpoint

架构设计:
- 使用纯字典列表表示消息，兼容 OpenAI messages 格式
- token 估算委托给 utils.estimate_tokens 统一实现（中文字 1:1、英文单词/数字串/标点各计 1，另加固定开销）
"""

from __future__ import annotations

import logging
from typing import Any

from app.shared.services.ai.agent.types import AgentTurn

logger = logging.getLogger(__name__)

# 默认最大 token 预算
DEFAULT_MAX_TOKENS = 120000
# 单条消息保留的最大字符数
_MAX_MESSAGE_CHARS = 8000


class AgentMemory:
    """
    @classdesc Agent 短期记忆

    维护 system prompt + 用户初始任务 + 多轮对话历史。
    """

    def __init__(self, system_prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS):
        """
        @methoddesc 初始化记忆

        参数:
            system_prompt: 系统提示词
            max_tokens: 最大 token 预算
        """
        self.system_prompt = system_prompt
        self.max_tokens = max_tokens
        self._messages: list[dict[str, Any]] = []
        self._turns: list[AgentTurn] = []
        self._turn_count: int = 0
        if system_prompt:
            self._messages.append({"role": "system", "content": system_prompt})

    def set_task(self, task_message: str) -> None:
        """设置用户初始任务消息。"""
        # 确保只有一条用户初始任务，避免重复
        self._messages = [m for m in self._messages if not (m.get("role") == "user" and m.get("_is_task"))]
        self._messages.append({"role": "user", "content": task_message, "_is_task": True})

    def add_assistant_message(
        self,
        content: str | None,
        tool_calls: list[dict[str, Any]] | None = None,
    ) -> None:
        """添加 assistant 消息。"""
        msg: dict[str, Any] = {"role": "assistant"}
        if content:
            msg["content"] = self._truncate(content)
        if tool_calls:
            msg["tool_calls"] = tool_calls
        self._messages.append(msg)

    def add_tool_result(self, tool_call_id: str, name: str, result: dict[str, Any] | str) -> None:
        """添加工具结果消息。"""
        observation = result if isinstance(result, str) else self._dict_to_observation(result)
        self._messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": name,
                "content": self._truncate(observation),
            }
        )

    def add_system_reminder(self, content: str) -> None:
        """注入一条系统级提醒消息（用 user role，带 _is_reminder 标记）。

        为什么不用 role="system"：get_messages 会跳过所有 role=="system" 的非首条消息，
        导致 reminder 被丢弃。用 user role 可确保它进入 LLM 的上下文。

        用途（P1-2 收敛引导）：
        - 接近 max_iterations 时提醒 LLM 直接回复、停止调工具
        - 检测到跨轮重复调用同一工具同参数时提醒 LLM 使用已有结果

        参数:
            content: 提醒文本
        """
        if not content:
            return
        self._messages.append({"role": "user", "content": self._truncate(content), "_is_reminder": True})

    def add_turn(self, turn: AgentTurn) -> None:
        """记录完整 turn。"""
        self._turns.append(turn)
        self._turn_count += 1

    def get_messages(self) -> list[dict[str, Any]]:
        """
        @methoddesc 获取截断后的消息列表

        保留 system prompt 和最近的用户/assistant/tool 消息，不超出 token 预算。
        截断后做 tool_calls/tool 配对修正，保证送给 provider 的序列不含
        孤儿 tool 消息或残缺的 tool_calls（OpenAI 兼容 API 对二者直接返回 400）。
        """
        # 计算 system prompt 开销
        system_tokens = self._estimate_tokens(self.system_prompt)
        budget = self.max_tokens - system_tokens

        # 从后往前累加，直到预算用完
        selected: list[dict[str, Any]] = []
        total = 0
        # 跳过 system prompt（已在开头）
        for msg in reversed(self._messages):
            if msg.get("role") == "system":
                continue
            tokens = self._estimate_message_tokens(msg)
            if total + tokens > budget and selected:
                break
            selected.append(msg)
            total += tokens

        selected.reverse()
        selected = self._repair_tool_pairing(selected)

        result: list[dict[str, Any]] = []
        if self.system_prompt:
            result.append({"role": "system", "content": self.system_prompt})
        result.extend(selected)
        return result

    @staticmethod
    def _repair_tool_pairing(selected: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """修正截断边界的 tool_calls/tool 配对。

        不变量：输出序列中每个 tool 消息都有前面被保留的 assistant(tool_calls)，
        每个 assistant(tool_calls) 的每个 tool_call id 都有对应的 tool 结果消息。
        违反任一条，OpenAI 兼容 API 普遍返回 400，多轮会话会"越聊越挂"。

        截断按 token 预算从尾往前选消息、边界不感知配对，两类典型破坏：
        1. 预算恰好耗尽在 assistant(tool_calls) 与其 tool 结果之间（或结果序列中间）
           → 选中片段以孤儿 tool 开头（其归属的 assistant 在界外）
        2. 保留了 assistant(tool_calls) 但对应结果被丢（如截断丢结果、
           checkpoint 恢复到结果未落盘的中间态）→ 残缺 tool_calls

        前向单遍清洗：先收集界内全部 tool_call_id 应答集，再逐条决定去留——
        assistant(tool_calls) 的 id 未全部被应答则丢弃该 assistant；
        tool 消息的 id 不属于任何被保留的 assistant 则丢弃（主人总在工具之前，
        故遍历到 tool 时其主人的去留已判定）。
        """
        answered_ids = {m.get("tool_call_id") for m in selected if m.get("role") == "tool"}
        kept_call_ids: set[Any] = set()
        repaired: list[dict[str, Any]] = []
        for msg in selected:
            role = msg.get("role")
            if role == "assistant" and msg.get("tool_calls"):
                call_ids = {tc.get("id") for tc in msg["tool_calls"]}
                if call_ids <= answered_ids:
                    repaired.append(msg)
                    kept_call_ids |= call_ids
                # 任一 tool_call 无对应结果 → 丢弃整条 assistant（配对必须完整）
            elif role == "tool":
                if msg.get("tool_call_id") in kept_call_ids:
                    repaired.append(msg)
                # 孤儿 tool（主人被截掉或被上一分支丢弃）→ 丢弃
            else:
                repaired.append(msg)
        return repaired

    def get_turns(self) -> list[AgentTurn]:
        """获取所有 turn 记录。"""
        return self._turns

    def create_checkpoint(self) -> dict[str, Any]:
        """创建当前记忆 checkpoint（含完整 messages，支持跨进程恢复）。"""
        return {
            "system_prompt": self.system_prompt,
            "max_tokens": self.max_tokens,
            "message_count": len(self._messages),
            "turn_count": self._turn_count,
            "messages": [dict(m) for m in self._messages],
        }

    @classmethod
    def restore_from_checkpoint(cls, checkpoint: dict[str, Any]) -> AgentMemory:
        """从 checkpoint 重建 memory 状态。

        参数:
            checkpoint: create_checkpoint 返回的字典

        返回:
            重建的 AgentMemory 实例
        """
        mem = cls(
            system_prompt=checkpoint.get("system_prompt", ""),
            max_tokens=checkpoint.get("max_tokens", DEFAULT_MAX_TOKENS),
        )
        mem._messages = [dict(m) for m in checkpoint.get("messages", [])]
        mem._turn_count = checkpoint.get("turn_count", 0)
        return mem

    @staticmethod
    def _truncate(text: str, max_chars: int = _MAX_MESSAGE_CHARS) -> str:
        """截断超长文本（最终兜底）。"""
        if len(text) <= max_chars:
            return text
        return text[:max_chars] + f"\n... [truncated {len(text) - max_chars} chars]"

    @staticmethod
    def _summarize_dict(data: dict[str, Any], max_field_chars: int = 1500) -> dict[str, Any]:
        """对工具结果的 dict 做智能裁剪。

        策略：小字段（< max_field_chars）完整保留；大字段（长列表/长字符串）截断，
        保留关键摘要信息（如 errors 列表的前几条、success 标志等）。
        相比直接对 JSON 文本硬截断，避免在字段中间被切断导致 agent 误解。
        """
        summarized: dict[str, Any] = {}
        for key, value in data.items():
            # 关键小字段始终完整保留
            if key in {"success", "error", "message", "total_rules", "passed", "issues"}:
                summarized[key] = value
                continue
            if isinstance(value, str):
                summarized[key] = value if len(value) <= max_field_chars else value[:max_field_chars] + "...[truncated]"
            elif isinstance(value, list):
                # 列表：保留前 5 项 + 计数提示
                if len(value) <= 5:
                    summarized[key] = value
                else:
                    summarized[key] = value[:5] + [f"...[{len(value) - 5} more items]"]
            elif isinstance(value, dict):
                # 嵌套 dict 递归裁剪（降阈值避免嵌套膨胀）
                summarized[key] = AgentMemory._summarize_dict(value, max_field_chars // 2)
            else:
                summarized[key] = value
        return summarized

    @staticmethod
    def _dict_to_observation(data: dict[str, Any]) -> str:
        """将字典转为 observation 文本（先智能裁剪大字段，避免 JSON 中途被硬截断）。"""
        import json

        summarized = AgentMemory._summarize_dict(data)
        try:
            return json.dumps(summarized, ensure_ascii=False, indent=2)
        except (TypeError, ValueError):
            return str(summarized)

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """粗略估算 token 数。

        委托给 utils.estimate_tokens 统一实现（中文/英文词/数字/标点分类加权），
        避免项目内两套不一致的 token 估算系数。延迟导入防循环依赖。
        """
        if not text:
            return 0
        from app.shared.services.ai.utils import estimate_tokens

        return estimate_tokens(text)

    @classmethod
    def _estimate_message_tokens(cls, msg: dict[str, Any]) -> int:
        """估算单条消息 token 数。"""
        content = msg.get("content") or ""
        tokens = cls._estimate_tokens(content)
        # tool_calls 也计入
        tool_calls = msg.get("tool_calls") or []
        for tc in tool_calls:
            func = tc.get("function", {})
            tokens += cls._estimate_tokens(func.get("name", ""))
            args = func.get("arguments")
            if isinstance(args, str):
                tokens += cls._estimate_tokens(args)
            elif isinstance(args, dict):
                tokens += cls._estimate_tokens(str(args))
        return tokens + 4  # 消息格式开销
