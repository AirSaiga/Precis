"""
@fileoverview Ollama 原生 Provider

功能概述:
- 使用 Ollama 原生 API（/api/chat、/api/tags）进行对话
- 实现非流式对话、流式对话、模型列表、健康检查
- 自动重试机制（指数退避，最多 3 次）
- Session 复用：通过 aiohttp.ClientSession 保持连接池

架构设计:
- 继承 BaseProvider，实现统一的 Provider 接口
- 使用 aiohttp 进行原生异步 HTTP 通信
- 与 OpenAIProvider 并行存在，供用户根据部署环境选择

输入示例:
    req = ChatRequest(
        messages=[ChatMessage(role="user", content="你好")],
        temperature=0.7
    )

输出示例:
    resp = await provider.chat(req)
    # ChatResponse(content="你好！", model="llama3.2")

    async for chunk in provider.chat_stream(req):
        print(chunk, end="")
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

try:
    import aiohttp as _aiohttp
except ImportError:
    _aiohttp = None  # type: ignore[assignment]

from .base import BaseProvider, ChatRequest, ChatResponse

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0


class OllamaProvider(BaseProvider):
    """
    @classdesc Ollama 原生 Provider

    使用 Ollama 原生 API（/api/chat、/api/tags）进行对话。
    支持非流式对话、流式对话、模型列表、健康检查。
    具备自动重试机制（指数退避，最多 3 次）。

    使用场景：
    - 本地部署的 Ollama 服务
    - 需要原生 Ollama 特性的场景
    """

    @property
    def name(self):
        return "Ollama"

    def __init__(self, config):
        super().__init__(config)
        self.timeout_seconds = config.network.timeout if config.network else 60
        self._session = None

    async def _get_session(self):
        """
        @methoddesc 获取或创建 aiohttp 会话（懒加载 + 自动重建）

        返回:
            aiohttp.ClientSession 实例
        """
        if _aiohttp is None:
            raise ImportError("aiohttp 未安装，请运行 pip install aiohttp")
        if self._session is None or self._session.closed:
            timeout = _aiohttp.ClientTimeout(total=self.timeout_seconds)
            self._session = _aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def close(self):
        """
        @methoddesc 显式关闭 HTTP 会话，释放连接池资源

        建议在不再需要 Provider 时调用，避免资源泄漏。
        """
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    def __del__(self):
        """
        @methoddesc 析构函数

        如果 session 未关闭则发出资源警告。
        """
        if self._session and not self._session.closed:
            import warnings

            warnings.warn("OllamaProvider 未显式关闭 session，请在使用完毕后调用 close()", ResourceWarning)

    async def _post(self, endpoint: str, data: dict) -> dict:
        if _aiohttp is None:
            raise ImportError("aiohttp 未安装，请运行 pip install aiohttp")

        url = f"{self.cfg.base_url}/api/{endpoint}"
        for attempt in range(_MAX_RETRIES):
            try:
                session = await self._get_session()
                async with session.post(url, json=data) as resp:
                    if resp.status >= 500:
                        raise _aiohttp.ClientResponseError(
                            request_info=resp.request_info,
                            history=resp.history,
                            status=resp.status,
                            message=f"服务端错误: {resp.status}",
                        )
                    if resp.status == 429:
                        raise _aiohttp.ClientResponseError(
                            request_info=resp.request_info,
                            history=resp.history,
                            status=resp.status,
                            message="请求被限流",
                        )
                    if resp.status >= 400:
                        text = await resp.text()
                        raise _aiohttp.ClientResponseError(
                            request_info=resp.request_info,
                            history=resp.history,
                            status=resp.status,
                            message=f"请求失败({resp.status}): {text[:200]}",
                        )
                    return await resp.json()
            except (_aiohttp.ClientConnectionError, asyncio.TimeoutError, _aiohttp.ClientResponseError) as e:
                should_retry = isinstance(e, (_aiohttp.ClientConnectionError, asyncio.TimeoutError)) or (
                    isinstance(e, _aiohttp.ClientResponseError) and e.status in (429, 500, 502, 503)
                )
                if should_retry and attempt < _MAX_RETRIES - 1:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(f"[Ollama] 请求失败（第 {attempt + 1} 次），{delay:.1f}s 后重试: {e}")
                    await asyncio.sleep(delay)
                else:
                    raise

    async def chat(self, req: ChatRequest) -> ChatResponse:
        """
        @methoddesc 发送非流式对话请求

        参数:
            req: 对话请求对象

        返回:
            ChatResponse: AI 回复内容

        异常:
            ValueError: 响应解析失败
        """
        data = {
            "model": self._get_model(req.model),
            "messages": [{"role": m.role, "content": m.content} for m in req.messages],
            "stream": False,
            "options": {"temperature": req.temperature},
        }
        resp = await self._post("chat", data)
        try:
            content = resp["message"]["content"]
            model = resp.get("model", self._get_model(req.model))
        except (KeyError, TypeError) as e:
            raise ValueError(f"解析 Ollama 响应失败: {e}, 响应: {resp}") from e
        return ChatResponse(content=content or "", model=model)

    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[str]:
        """
        @methoddesc 发送流式对话请求

        参数:
            req: 对话请求对象

        返回:
            异步生成器，逐块返回 AI 回复内容
        """
        if _aiohttp is None:
            raise ImportError("aiohttp 未安装，请运行 pip install aiohttp")

        data = {
            "model": self._get_model(req.model),
            "messages": [{"role": m.role, "content": m.content} for m in req.messages],
            "stream": True,
            "options": {"temperature": req.temperature},
        }
        url = f"{self.cfg.base_url}/api/chat"
        session = await self._get_session()
        async with session.post(url, json=data) as resp:
            if resp.status >= 400:
                text = await resp.text()
                raise _aiohttp.ClientResponseError(
                    request_info=resp.request_info,
                    history=resp.history,
                    status=resp.status,
                    message=f"流式请求失败({resp.status}): {text[:200]}",
                )
            async for line in resp.content:
                if line:
                    try:
                        chunk = json.loads(line)
                        if "error" in chunk:
                            raise ValueError(f"Ollama 流式错误: {chunk['error']}")
                        if "message" in chunk:
                            yield chunk["message"].get("content", "")
                    except json.JSONDecodeError:
                        continue

    async def list_models(self) -> list[str]:
        """
        @methoddesc 获取 Ollama 本地安装的模型列表

        返回:
            模型名称字符串列表
        """
        url = f"{self.cfg.base_url}/api/tags"
        session = await self._get_session()
        async with session.get(url) as resp:
            data = await resp.json()
            return [m["name"] for m in data.get("models", [])]

    async def health(self) -> dict[str, Any]:
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
            await self.list_models()
            return {"status": "ok", "latency_ms": int((time.time() - start) * 1000)}
        except Exception as e:
            return {"status": "error", "error": str(e)}
