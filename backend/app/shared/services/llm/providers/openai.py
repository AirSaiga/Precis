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

from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from .base import BaseProvider, ChatRequest, ChatResponse

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
        # 初始化异步 OpenAI 客户端
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
                resp = await self.client.chat.completions.create(
                    model=self._get_model(req.model),
                    messages=[{"role": m.role, "content": m.content} for m in req.messages],
                    temperature=req.temperature,
                    stream=False,
                )
                if not resp.choices:
                    raise ValueError("API 返回空的 choices 列表")
                content = resp.choices[0].message.content
                if content is None:
                    content = ""
                return ChatResponse(content=content, model=resp.model)
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

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[str]:
        """
        @methoddesc 发送流式对话请求，逐块返回内容

        参数:
            req: 对话请求对象

        返回:
            异步生成器，每个内容块字符串（逐字或逐句）

        异常:
            APIConnectionError: 网络连接失败
            APIStatusError: 服务端返回错误
            ValueError: 流式响应解析异常
        """
        try:
            stream = await self.client.chat.completions.create(
                model=self._get_model(req.model),
                messages=[{"role": m.role, "content": m.content} for m in req.messages],
                temperature=req.temperature,
                stream=True,
            )
            # 逐块读取流式响应，过滤空块
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    yield delta.content
        except (APIConnectionError, APIStatusError):
            raise
        except Exception as e:
            raise ValueError(f"流式响应异常: {e}") from e

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
