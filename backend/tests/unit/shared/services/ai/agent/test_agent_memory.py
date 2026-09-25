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
"""AgentMemory 截断配对修正测试

覆盖 get_messages 的 tool_calls/tool 配对不变量：
- 预算恰好耗尽在 assistant(tool_calls) 与其 tool 结果之间 → 孤儿 tool 被丢弃
- 预算耗尽在 tool 结果序列中间 / 整段工具交换被截掉 → 同样无孤儿
- 全保留（预算充足）→ 历史完整、配对不变
- 全丢弃极端（预算只够最新一条且最新条是 tool）→ 只剩 system
- 尾部 assistant(tool_calls) 无对应结果（checkpoint 中间态）→ 丢弃该 assistant
- 中部残缺配对（历史本身缺结果）→ 修正为只含完整配对的序列

背景：OpenAI 兼容 API 对孤儿 tool 消息/残缺 tool_calls 普遍返回 400，
多轮会话会"越聊越挂"。
"""

from __future__ import annotations

from typing import Any

from app.shared.services.ai.agent.memory import AgentMemory


def _tc(call_id: str) -> dict[str, Any]:
    """构造最小可用的 tool_call dict（OpenAI 格式）。"""
    return {"id": call_id, "type": "function", "function": {"name": "noop", "arguments": "{}"}}


def _build_multi_turn_memory(max_tokens: int) -> AgentMemory:
    """构造含完整配对的多轮记忆。

    消息序列（去 system 后）：
    1. user 任务（小）
    2. assistant（大 content + tool_calls c1）—— 大体积确保中档预算下被截在界外
    3. tool(c1)（大 content）
    4. user 提醒（小）
    5. assistant 收尾（小）

    token 量级（estimate_tokens：中文 1 字 1 token + 每次调用 10 固定开销）：
    msg2 ≈ 1510+23+4，msg3 ≈ 2010 —— 预算落在 [2034, 3571) 时选中片段以 tool 开头。
    """
    mem = AgentMemory(system_prompt="系", max_tokens=max_tokens)
    mem.set_task("任务")
    mem.add_assistant_message(content="前" * 1500, tool_calls=[_tc("c1")])
    mem.add_tool_result("c1", "noop", "果" * 2000)
    mem.add_system_reminder("继续")
    mem.add_assistant_message(content="好的")
    return mem


def _assert_tool_pairing_intact(messages: list[dict[str, Any]]) -> None:
    """断言输出序列满足配对不变量：tool 有前置主人，assistant(tool_calls) 的调用全部被应答。"""
    body = [m for m in messages if m.get("role") != "system"]
    declared_ids: set[Any] = set()
    answered_ids: set[Any] = set()
    for m in body:
        if m.get("role") == "tool":
            assert m.get("tool_call_id") in declared_ids, f"孤儿 tool 消息: {m.get('tool_call_id')}"
            answered_ids.add(m.get("tool_call_id"))
        elif m.get("role") == "assistant" and m.get("tool_calls"):
            for tc in m["tool_calls"]:
                declared_ids.add(tc.get("id"))
    assert declared_ids == answered_ids, f"残缺 tool_calls: 未被应答 {declared_ids - answered_ids}"


def test_budget_exhausted_between_tool_call_and_result_drops_orphan_tool():
    """预算恰好耗尽在 assistant(tool_calls) 与其 tool 结果之间 → 孤儿 tool 被丢弃。

    选中片段原为 [tool(c1), user, assistant]（以 tool 开头），
    修正后必须以 user/assistant 开头——否则 OpenAI 兼容 API 直接 400。
    """
    mem = _build_multi_turn_memory(max_tokens=2800)

    result = mem.get_messages()

    roles = [m["role"] for m in result]
    assert roles == ["system", "user", "assistant"]
    assert result[1]["content"] == "继续"
    assert result[2]["content"] == "好的"
    _assert_tool_pairing_intact(result)


def test_budget_exhausted_inside_tool_run_drops_partial_run():
    """预算耗尽在 tool 结果序列中间 → 只保留的半个工具组被整体丢弃。

    构造 assistant(c1,c2) 双工具调用，预算只够两条 tool 结果之一：
    选中片段 [tool(c2), user, assistant] → 修正后 [user, assistant]。
    """
    mem = AgentMemory(system_prompt="系", max_tokens=3200)
    mem.set_task("任务")
    mem.add_assistant_message(content="前" * 1500, tool_calls=[_tc("c1"), _tc("c2")])
    mem.add_tool_result("c1", "noop", "果" * 1200)
    mem.add_tool_result("c2", "noop", "果" * 1200)
    mem.add_system_reminder("继续")
    mem.add_assistant_message(content="好的")

    result = mem.get_messages()

    roles = [m["role"] for m in result]
    assert roles == ["system", "user", "assistant"]
    _assert_tool_pairing_intact(result)


def test_budget_keeps_whole_tool_run_but_not_owner_drops_entire_run():
    """预算容下整段 tool 结果但容不下归属 assistant → 整段工具交换一并丢弃。

    选中片段 [tool(c1), tool(c2), user, assistant]（主人 assistant 在界外），
    修正后不得残留任何孤儿 tool。
    """
    mem = AgentMemory(system_prompt="系", max_tokens=3800)
    mem.set_task("任务")
    mem.add_assistant_message(content="前" * 1500, tool_calls=[_tc("c1"), _tc("c2")])
    mem.add_tool_result("c1", "noop", "果" * 1200)
    mem.add_tool_result("c2", "noop", "果" * 1200)
    mem.add_system_reminder("继续")
    mem.add_assistant_message(content="好的")

    result = mem.get_messages()

    roles = [m["role"] for m in result]
    assert roles == ["system", "user", "assistant"]
    _assert_tool_pairing_intact(result)


def test_large_budget_preserves_full_history_with_pairing():
    """预算充足（全保留极端）→ 历史完整保留，配对原样，无消息被误伤。"""
    mem = _build_multi_turn_memory(max_tokens=999999)

    result = mem.get_messages()

    roles = [m["role"] for m in result]
    assert roles == ["system", "user", "assistant", "tool", "user", "assistant"]
    # tool_calls 与 tool 结果的 id 严格对应
    assistant_tc = result[2]["tool_calls"]
    assert [tc["id"] for tc in assistant_tc] == [result[3]["tool_call_id"]]
    _assert_tool_pairing_intact(result)


def test_tiny_budget_with_trailing_tool_drops_everything():
    """全丢弃极端：预算只够保住最新一条且最新条是 tool → 修正后只剩 system。

    截断循环"至少保留最新一条"会把孤儿 tool 留下，修正必须把它清掉——
    只发 system 也好过发孤儿 tool（后者必 400）。
    """
    mem = AgentMemory(system_prompt="系", max_tokens=11)
    mem.set_task("任务")
    mem.add_assistant_message(content=None, tool_calls=[_tc("c9")])
    mem.add_tool_result("c9", "noop", "果" * 50)

    result = mem.get_messages()

    assert [m["role"] for m in result] == ["system"]
    _assert_tool_pairing_intact(result)


def test_trailing_assistant_tool_calls_without_results_dropped():
    """尾部 assistant(tool_calls) 无对应结果（如 checkpoint 恢复到结果落盘前）→ 丢弃该 assistant。"""
    mem = AgentMemory(system_prompt="系", max_tokens=999999)
    mem.set_task("任务")
    mem.add_assistant_message(content=None, tool_calls=[_tc("c8")])

    result = mem.get_messages()

    roles = [m["role"] for m in result]
    assert roles == ["system", "user"]
    _assert_tool_pairing_intact(result)


def test_mid_history_unpaired_assistant_normalized():
    """历史本身残缺（中部 assistant(tool_calls) 无结果）→ 输出仍满足配对不变量。"""
    mem = AgentMemory(system_prompt="系", max_tokens=999999)
    mem.set_task("任务")
    mem.add_assistant_message(content=None, tool_calls=[_tc("c7")])
    mem.add_system_reminder("继续")
    mem.add_assistant_message(content="好的")

    result = mem.get_messages()

    # 残缺的 assistant(c7) 被丢弃，其余消息原样保留
    roles = [m["role"] for m in result]
    assert roles == ["system", "user", "user", "assistant"]
    assert result[-1]["content"] == "好的"
    _assert_tool_pairing_intact(result)


def test_repair_keeps_paired_exchange_spanning_boundary_intact():
    """对照：边界落在配对之外的合法截断 → 保留的完整工具交换原样通过。

    预算使第一轮大体积工具交换整体落在界外、边界停在 user 消息上——
    第二轮完整交换（assistant(c2) + tool(c2) + 收尾）必须原样保留。
    """
    mem = AgentMemory(system_prompt="系", max_tokens=1011)
    mem.set_task("任务")
    mem.add_assistant_message(content="前" * 1500, tool_calls=[_tc("c1")])
    mem.add_tool_result("c1", "noop", "果" * 2000)
    mem.add_system_reminder("继续")
    mem.add_assistant_message(content="好的")
    # 第二轮完整工具交换（预算内必须整体保留）
    mem.add_assistant_message(content=None, tool_calls=[_tc("c2")])
    mem.add_tool_result("c2", "noop", "果" * 100)
    mem.add_assistant_message(content="完成")

    result = mem.get_messages()

    # 边界停在 user(继续) 上：第一轮大体积交换（task 之后的 assistant+tool）整体在界外
    roles = [m["role"] for m in result]
    assert roles == ["system", "user", "assistant", "assistant", "tool", "assistant"]
    assert result[-3]["tool_calls"][0]["id"] == "c2"
    assert result[-2]["tool_call_id"] == "c2"
    _assert_tool_pairing_intact(result)
