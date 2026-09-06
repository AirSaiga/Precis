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
