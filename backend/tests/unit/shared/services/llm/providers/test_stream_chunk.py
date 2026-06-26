"""StreamChunk 类型测试。"""

from __future__ import annotations

from app.shared.services.llm.providers.base import StreamChunk


def test_stream_chunk_delta():
    """delta 类型 StreamChunk。"""
    chunk = StreamChunk(type="delta", text="你好")
    assert chunk.type == "delta"
    assert chunk.text == "你好"
    assert chunk.tool_calls is None


def test_stream_chunk_tool_calls():
    """tool_calls 类型 StreamChunk。"""
    tcs = [{"id": "call_1", "function": {"name": "f", "arguments": "{}"}}]
    chunk = StreamChunk(type="tool_calls", tool_calls=tcs)
    assert chunk.type == "tool_calls"
    assert chunk.tool_calls == tcs
    assert chunk.text is None
