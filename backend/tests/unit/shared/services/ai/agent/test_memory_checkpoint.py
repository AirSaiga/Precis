"""@fileoverview AgentMemory checkpoint 序列化/恢复测试

覆盖 create_checkpoint 含完整 messages + restore_from_checkpoint 往返一致性。
- create_checkpoint 返回 messages 列表(OpenAI 格式 dict),而非仅有 message_count
- JSON 序列化(dumps/loads)后能完整还原 _messages / _turn_count
- 空 checkpoint (无 messages) → restore 后 _messages 为空,不报错
- restore_from_checkpoint 重建 system_prompt / max_tokens
- 多次 add_* 后再 checkpoint, 恢复后 _messages 严格相等
"""

from __future__ import annotations

import json

from app.shared.services.ai.agent.memory import AgentMemory
from app.shared.services.ai.agent.types import AgentTurn


def _make_memory_with_history(system_prompt: str = "you are a tester") -> AgentMemory:
    """构造一个有多轮历史的 memory(用于 checkpoint 往返测试)。"""
    mem = AgentMemory(system_prompt=system_prompt, max_tokens=80000)
    mem.set_task("task: do something")
    mem.add_assistant_message(content="first reply", tool_calls=None)
    mem.add_tool_result(
        tool_call_id="c1",
        name="noop",
        result={"success": True, "value": 42},
    )
    mem.add_assistant_message(
        content="second reply",
        tool_calls=[{"id": "c2", "type": "function", "function": {"name": "noop", "arguments": "{}"}}],
    )
    turn = AgentTurn(turn=1, content="first reply")
    mem.add_turn(turn)
    return mem


def test_create_checkpoint_contains_messages_list():
    """create_checkpoint 返回值必须含 messages 字段,且非空。"""
    mem = _make_memory_with_history()
    cp = mem.create_checkpoint()
    assert "messages" in cp, "checkpoint 必须含 messages 字段"
    assert isinstance(cp["messages"], list)
    # 含 system + task + 2 assistant + 1 tool = 至少 5 条
    assert len(cp["messages"]) >= 5
    # 消息以 system prompt 开头
    assert cp["messages"][0]["role"] == "system"
    # 含 task 标记的用户消息
    task_msgs = [m for m in cp["messages"] if m.get("role") == "user" and m.get("_is_task")]
    assert len(task_msgs) == 1


def test_create_checkpoint_preserves_turn_and_message_count():
    """turn_count / message_count 与底层 _messages / _turns 数量一致。"""
    mem = _make_memory_with_history()
    cp = mem.create_checkpoint()
    assert cp["message_count"] == len(mem._messages)
    assert cp["turn_count"] == len(mem._turns)
    assert cp["turn_count"] == 1
    assert cp["message_count"] == len(mem._messages)


def test_create_checkpoint_contains_system_prompt_and_max_tokens():
    """checkpoint 含 system_prompt 与 max_tokens,用于恢复时配置。"""
    mem = AgentMemory(system_prompt="sys-xyz", max_tokens=77777)
    cp = mem.create_checkpoint()
    assert cp["system_prompt"] == "sys-xyz"
    assert cp["max_tokens"] == 77777


def test_create_checkpoint_messages_are_json_serializable():
    """checkpoint 可被 json.dumps/loads 完整往返。"""
    mem = _make_memory_with_history()
    cp = mem.create_checkpoint()
    payload = json.dumps(cp, ensure_ascii=False)
    restored = json.loads(payload)
    assert isinstance(restored["messages"], list)
    assert len(restored["messages"]) == len(cp["messages"])


def test_restore_from_checkpoint_round_trip_messages():
    """create_checkpoint → restore_from_checkpoint 后 _messages 严格一致。"""
    mem = _make_memory_with_history()
    cp = mem.create_checkpoint()
    restored = AgentMemory.restore_from_checkpoint(cp)
    assert len(restored._messages) == len(mem._messages)
    for a, b in zip(restored._messages, mem._messages, strict=True):
        assert a == b, f"message 不一致: {a} vs {b}"


def test_restore_from_checkpoint_round_trip_turn_count():
    """restore_from_checkpoint 后 _turn_count 与原始一致。"""
    mem = _make_memory_with_history()
    cp = mem.create_checkpoint()
    restored = AgentMemory.restore_from_checkpoint(cp)
    assert restored._turn_count == mem._turn_count == 1


def test_restore_from_checkpoint_restores_system_prompt_and_max_tokens():
    """restore_from_checkpoint 重建 system_prompt 与 max_tokens。"""
    mem = AgentMemory(system_prompt="restore-sys", max_tokens=55555)
    mem.set_task("task")
    cp = mem.create_checkpoint()
    restored = AgentMemory.restore_from_checkpoint(cp)
    assert restored.system_prompt == "restore-sys"
    assert restored.max_tokens == 55555


def test_restore_from_checkpoint_with_json_round_trip():
    """JSON dumps/loads 后 restore_from_checkpoint 仍能正确恢复(模拟跨进程)。"""
    mem = _make_memory_with_history(system_prompt="sys-rt")
    cp = mem.create_checkpoint()
    payload = json.dumps(cp, ensure_ascii=False)
    restored_dict = json.loads(payload)
    restored = AgentMemory.restore_from_checkpoint(restored_dict)
    assert restored.system_prompt == "sys-rt"
    assert len(restored._messages) == len(mem._messages)
    # 抽样验证 tool_call 字段也保留
    tool_msgs = [m for m in restored._messages if m.get("role") == "assistant" and m.get("tool_calls")]
    assert tool_msgs, "应至少有一条含 tool_calls 的 assistant 消息"


def test_restore_from_checkpoint_empty_messages():
    """空 messages 列表 → restore 不报错,_messages 为空。"""
    cp = {"turn_count": 0, "message_count": 0, "messages": [], "system_prompt": "", "max_tokens": 120000}
    mem = AgentMemory.restore_from_checkpoint(cp)
    assert mem._messages == []
    assert mem._turn_count == 0


def test_restore_from_checkpoint_missing_optional_fields():
    """缺省字段(老 checkpoint 格式)→ restore 不报错,采用默认值。"""
    cp = {"messages": []}
    mem = AgentMemory.restore_from_checkpoint(cp)
    assert mem._messages == []
    assert mem._turn_count == 0
    # system_prompt/max_tokens 走 cls 默认值
    assert mem.system_prompt == ""
    assert mem.max_tokens == 120000


def test_restore_from_checkpoint_returns_new_instance():
    """restore_from_checkpoint 返回新的 AgentMemory 实例(不影响原对象)。"""
    mem = _make_memory_with_history()
    cp = mem.create_checkpoint()
    restored = AgentMemory.restore_from_checkpoint(cp)
    assert restored is not mem
    # 修改 restored 不影响原 mem
    restored.add_assistant_message(content="extra")
    assert len(restored._messages) == len(mem._messages) + 1


def test_restore_from_checkpoint_preserves_underscore_task_marker():
    """任务消息的 _is_task 标记在 round-trip 后保留。"""
    mem = AgentMemory(system_prompt="sys")
    mem.set_task("the task")
    cp = mem.create_checkpoint()
    restored = AgentMemory.restore_from_checkpoint(cp)
    task_msgs = [m for m in restored._messages if m.get("role") == "user" and m.get("_is_task")]
    assert len(task_msgs) == 1
    assert task_msgs[0]["content"] == "the task"
