"""@fileoverview ChatAgentRunner 回调配置入口测试

验证 configure_callbacks 存储回调、未配置时为空、回调可被调用。
"""

from __future__ import annotations

from unittest.mock import MagicMock

from app.shared.services.ai.chat_agent_runner import ChatAgentRunner


def test_configure_callbacks_stores_callbacks():
    """configure_callbacks 存储回调，可通过 _callbacks 访问且可调用。"""
    runner = ChatAgentRunner(provider=MagicMock(), project_path="/tmp", context_nodes=[])
    on_chunk = lambda t: None  # noqa: E731
    on_turn = lambda n: None  # noqa: E731
    runner.configure_callbacks(
        on_chunk=on_chunk,
        on_turn=on_turn,
        on_tool_call=lambda name, cid, turn: None,
        on_tool_result=lambda r: None,
        cancelled=lambda: False,
    )
    # 回调应被存储为 _callbacks 的键
    assert "on_chunk" in runner._callbacks
    assert "on_turn" in runner._callbacks
    assert runner._callbacks["on_chunk"] is on_chunk
    assert runner._callbacks["on_turn"] is on_turn
    # 调用不报错
    runner._callbacks["on_chunk"]("x")


def test_callbacks_defaults_to_empty():
    """未调用 configure_callbacks 时，_callbacks 为空 dict（run 时 .get 返回 None → executor 用默认 noop）。"""
    runner = ChatAgentRunner(provider=MagicMock(), project_path="/tmp", context_nodes=[])
    assert runner._callbacks == {}
