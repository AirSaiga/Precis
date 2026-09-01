"""@fileoverview OpenAI 兼容 /chat/completions 流式端点测试

覆盖 B-fix: SSE 流在首个 chunk 之前抛错时，except 分支引用的 `json` 此前是
try 内循环体的局部 import，未绑定 → NameError 掩盖真实错误。
修复后 `import json` 提升到模块级，真实错误应随 SSE error 帧透传并正常收尾。
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.api.routers.ai.chat import chat_completions
from app.api.routers.ai.models import ChatMessageInput, ChatRequestInput


def _fake_config() -> SimpleNamespace:
    provider_cfg = SimpleNamespace(id="prov1", model="m1")
    return SimpleNamespace(defaults={"chat": "prov1"}, providers=[provider_cfg])


def _request(stream: bool) -> ChatRequestInput:
    return ChatRequestInput(
        provider_id="prov1",
        messages=[ChatMessageInput(role="user", content="hi")],
        stream=stream,
    )


def _consume_stream(resp_coro) -> str:
    """await 端点协程并消费 StreamingResponse 的 body_iterator，拼接为完整文本。"""

    async def _run() -> str:
        resp = await resp_coro
        frames = []
        async for chunk in resp.body_iterator:
            frames.append(chunk.decode("utf-8") if isinstance(chunk, (bytes, bytearray)) else chunk)
        return "".join(frames)

    return asyncio.run(_run())


def test_stream_error_before_first_chunk_yields_error_frame_not_nameerror():
    """首个 chunk 之前抛错：真实错误透传到 SSE error 帧，流正常收尾，不再 NameError。"""

    async def failing_stream(chat_req):
        raise RuntimeError("boom-before-chunk")
        yield  # pragma: no cover — 仅为使其成为异步生成器

    provider = SimpleNamespace(chat_stream=failing_stream)

    with (
        patch("app.api.routers.ai.chat.loader") as mock_loader,
        patch("app.api.routers.ai.chat.create", return_value=provider),
    ):
        mock_loader.load.return_value = _fake_config()
        out = _consume_stream(chat_completions(_request(stream=True)))

    # 真实错误被透传（此前此处会因 json 未绑定抛 NameError，掩盖真实错误）
    assert "boom-before-chunk" in out
    assert "NameError" not in out
    # 起始帧 + error 帧 + [DONE] 收尾
    assert '"delta":{"role":"assistant"}' in out
    assert out.rstrip().endswith("data: [DONE]")


def test_stream_success_path_still_emits_deltas_and_done():
    """对照: 正常流式路径（修复 import 位置后行为不变）。"""

    async def ok_stream(chat_req):
        yield SimpleNamespace(type="delta", text="你")
        yield SimpleNamespace(type="delta", text="好")

    provider = SimpleNamespace(chat_stream=ok_stream)

    with (
        patch("app.api.routers.ai.chat.loader") as mock_loader,
        patch("app.api.routers.ai.chat.create", return_value=provider),
    ):
        mock_loader.load.return_value = _fake_config()
        out = _consume_stream(chat_completions(_request(stream=True)))

    # json.dumps 默认 ensure_ascii=True（\uXXXX 转义），解析 data 帧还原内容断言
    frames = [line[len("data: ") :] for line in out.splitlines() if line.startswith("data: ")]
    payloads = [json.loads(f) for f in frames if f != "[DONE]"]
    contents = [p["choices"][0]["delta"].get("content") for p in payloads]
    assert [c for c in contents if c] == ["你", "好"]
    assert "[DONE]" in out


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
