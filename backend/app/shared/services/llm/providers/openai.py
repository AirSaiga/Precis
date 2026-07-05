"""
@fileoverview OpenAI 兼容 Provider

功能概述:
- 支持 OpenAI API 格式的所有服务（云端和本地）
- 实现非流式对话、流式对话、模型列表、健康检查
- 自动重试机制（指数退避，最多 3 次）
- 错误分类处理：网络错误、服务端错误、响应解析错误

架构设计:
- 继承 BaseProvider，实现统一的 Provider 接口
- 使用 AsyncOpenAI 客户端进行异步 HTTP 通信
- 与配置模型联动：从 AIProvider 读取 base_url、api_key、timeout

输入示例:
    req = ChatRequest(
        messages=[ChatMessage(role="user", content="你好")],
        temperature=0.7
    )

输出示例:
    resp = await provider.chat(req)
    # ChatResponse(content="你好！", model="gpt-4")

    async for chunk in provider.chat_stream(req):
        print(chunk, end="")
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from openai import APIConnectionError, APIStatusError, AsyncOpenAI
else:
    try:
        from openai import APIConnectionError, APIStatusError, AsyncOpenAI
    except ImportError:
        APIConnectionError = None
        APIStatusError = None
        AsyncOpenAI = None

from .base import BaseProvider, ChatRequest, ChatResponse, StreamChunk

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0


class OpenAIProvider(BaseProvider):
    """
    @classdesc OpenAI 兼容 Provider

    支持 OpenAI API 格式的所有服务（云端和本地）。
    实现非流式对话、流式对话、模型列表、健康检查。
    具备自动重试机制（指数退避，最多 3 次）。

    使用场景：
    - OpenAI 官方 API
    - 本地 OpenAI 兼容服务（如 vLLM、TGI 等）
    - 其他 OpenAI 格式兼容的云端服务
    """

    @property
    def name(self):
        return "OpenAI-Compatible"

    def __init__(self, config):
        super().__init__(config)
        if AsyncOpenAI is None:
            raise ImportError("openai 未安装，请运行 pip install openai")
        self.client = AsyncOpenAI(
            base_url=config.base_url,
            api_key=config.api_key or "",
            timeout=config.network.timeout if config.network else 60,
        )

    async def chat(self, req: ChatRequest) -> ChatResponse:
        """
        @methoddesc 发送非流式对话请求，支持自动重试

        当遇到网络错误或限流（429）/服务端错误（500, 502, 503）时，
        会进行最多 3 次指数退避重试。

        参数:
            req: 对话请求对象

        返回:
            ChatResponse: AI 回复内容

        异常:
            ValueError: API 响应解析失败
            APIConnectionError: 网络连接持续失败
            APIStatusError: 服务端返回非 2xx 状态码且不可重试
        """
        for attempt in range(_MAX_RETRIES):
            try:
                # 构造 messages payload，支持 tool_calls 和 tool_call_id
                messages_payload = []
                for m in req.messages:
                    msg: dict = {"role": m.role}
                    if m.content is not None:
                        msg["content"] = m.content
                    if m.tool_calls is not None:
                        msg["tool_calls"] = m.tool_calls
                    if m.tool_call_id is not None:
                        msg["tool_call_id"] = m.tool_call_id
                    messages_payload.append(msg)

                kwargs: dict = {
                    "model": self._get_model(req.model),
                    "messages": messages_payload,
                    "temperature": req.temperature,
                    "stream": False,
                }
                if req.tools:
                    kwargs["tools"] = req.tools
                    kwargs["tool_choice"] = req.tool_choice if req.tool_choice is not None else "auto"

                resp = await self.client.chat.completions.create(**kwargs)
                if not resp.choices:
                    raise ValueError("API 返回空的 choices 列表")
                message = resp.choices[0].message
                content = message.content or ""

                # 解析 tool_calls
                tool_calls = None
                raw_tool_calls = getattr(message, "tool_calls", None)
                if raw_tool_calls:
                    tool_calls = []
                    for tc in raw_tool_calls:
                        tool_calls.append(
                            {
                                "id": getattr(tc, "id", ""),
                                "type": getattr(tc, "type", "function"),
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments,
                                },
                            }
                        )

                return ChatResponse(content=content, tool_calls=tool_calls, model=resp.model)
            except (APIConnectionError, APIStatusError) as e:
                # 非可重试状态码直接抛出异常
                if isinstance(e, APIStatusError) and e.status_code not in (429, 500, 502, 503):
                    raise
                # 未达到最大重试次数时，指数退避后重试
                if attempt < _MAX_RETRIES - 1:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(f"[OpenAI] 请求失败（第 {attempt + 1} 次），{delay:.1f}s 后重试: {e}")
                    await asyncio.sleep(delay)
                else:
                    raise
            except (IndexError, AttributeError, TypeError) as e:
                raise ValueError(f"解析 API 响应失败: {e}") from e

        # 所有重试已耗尽且未正常返回，理论上不会到达此处
        raise RuntimeError("OpenAI 请求在重试后仍未完成")

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """
        @methoddesc 发送流式对话请求（支持 tools 与 tool_calls 分片累积），逐块返回统一 StreamChunk

        统一输出契约:
        - delta 文本 → StreamChunk(type="delta", text=...)
        - tool_calls（分片累积， finish_reason="tool_calls" 时） → StreamChunk(type="tool_calls", tool_calls=[...原始格式]）

        重试策略（与 chat 对齐）：
        - 网络错误（APIConnectionError）或限流/服务端错误（429/500/502/503）触发指数退避重试，最多 _MAX_RETRIES 次。
        - **关键安全门**：只在"尚未 yield 任何 chunk 前"重试。一旦已经向下游输出过 token，
          即使后续流中断也不重试（避免重复输出导致内容错乱，且无法回收已发出的 chunk）。
        - 已 yield 后的异常直接抛出，由上层 executor 处理。

        参数:
            req: 对话请求对象

        返回:
            AsyncIterator[StreamChunk]: 统一流式输出单元

        异常:
            APIConnectionError: 网络连接失败（重试耗尽后）
            APIStatusError: 服务端返回错误（重试耗尽后）
            ValueError: 流式响应解析异常
        """
        # 构造 messages payload（与非流式 chat 一致，支持 tool_calls/tool_call_id 上下文）
        messages_payload = []
        for m in req.messages:
            msg: dict = {"role": m.role}
            if m.content is not None:
                msg["content"] = m.content
            if m.tool_calls is not None:
                msg["tool_calls"] = m.tool_calls
            if m.tool_call_id is not None:
                msg["tool_call_id"] = m.tool_call_id
            messages_payload.append(msg)

        kwargs: dict = {
            "model": self._get_model(req.model),
            "messages": messages_payload,
            "temperature": req.temperature,
            "stream": True,
        }
        if req.tools:
            kwargs["tools"] = req.tools
            kwargs["tool_choice"] = req.tool_choice if req.tool_choice is not None else "auto"

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            # 本轮标志：是否已向下游 yield 过任何 chunk。决定异常时能否重试。
            yielded_any = False
            try:
                stream = await self.client.chat.completions.create(**kwargs)

                # tool_calls 分片累积器: {index: {"id":"", "name":"", "arguments":""}}
                tc_acc: dict[int, dict[str, str]] = {}
                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    delta = choice.delta

                    # 1. 文本增量 → 立即 yield
                    if delta and delta.content:
                        yielded_any = True
                        yield StreamChunk(type="delta", text=delta.content)

                    # 2. tool_calls 分片 → 累积（不立即 yield）
                    if delta and delta.tool_calls:
                        for tc in delta.tool_calls:
                            slot = tc_acc.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                            if getattr(tc, "id", None):
                                slot["id"] = tc.id
                            if getattr(tc.function, "name", None):
                                slot["name"] = tc.function.name
                            slot["arguments"] += tc.function.arguments or ""

                    # 3. finish_reason="tool_calls" → 一次性 yield 完整 tool_calls（OpenAI 原始格式）
                    if choice.finish_reason == "tool_calls":
                        yielded_any = True
                        yield StreamChunk(
                            type="tool_calls",
                            tool_calls=[
                                {
                                    "id": v["id"],
                                    "type": "function",
                                    "function": {
                                        "name": v["name"],
                                        "arguments": v["arguments"],
                                    },
                                }
                                for v in tc_acc.values()
                            ],
                        )
                        tc_acc.clear()
                    # finish_reason="stop" → 流自然结束（循环结束），无需特殊处理
                # 流正常耗尽，返回
                return
            except (APIConnectionError, APIStatusError) as e:
                last_exc = e
                # 非可重试状态码直接抛出（与 chat 一致）
                if isinstance(e, APIStatusError) and e.status_code not in (429, 500, 502, 503):
                    raise
                # 已 yield 出 chunk 则不再重试（无法回收已发出的内容）
                if yielded_any:
                    raise
                # 未达最大重试次数 → 指数退避后重试
                if attempt < _MAX_RETRIES - 1:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(f"[OpenAI] 流式请求失败（第 {attempt + 1} 次），{delay:.1f}s 后重试: {e}")
                    await asyncio.sleep(delay)
                else:
                    raise
            except Exception as e:
                # 已 yield 出 chunk 后的非预期异常：不可重试（无法回收）
                if yielded_any:
                    raise ValueError(f"流式响应异常（已输出部分内容）: {e}") from e
                # 未 yield 前的解析类异常：不重试，直接抛出（与 chat 的 IndexError/AttributeError 分支对齐）
                raise ValueError(f"流式响应异常: {e}") from e

        # 理论上不会到达（重试耗尽会在循环内 raise）
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("OpenAI 流式请求在重试后仍未完成")

    async def list_models(self) -> list[str]:
        """
        @methoddesc 获取当前 Provider 可用的模型列表

        返回:
            模型 ID 字符串列表
        """
        models = await self.client.models.list()
        return [m.id for m in models.data]

    async def health(self):
        """
        @methoddesc 健康检查

        尝试获取模型列表并计算延迟。

        返回:
            {"status": "ok", "latency_ms": 延迟毫秒数} 或
            {"status": "error", "error": 错误信息}
        """
        import time

        start = time.time()
        try:
            await self.client.models.list()
            return {"status": "ok", "latency_ms": int((time.time() - start) * 1000)}
        except Exception as e:
            return {"status": "error", "error": str(e)}
