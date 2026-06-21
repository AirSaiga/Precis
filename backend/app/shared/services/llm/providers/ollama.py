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
        # 按模型名缓存探测到的上下文窗口，避免每次都发起 /api/show 请求
        self._context_window_cache: dict[str, int] = {}

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
            except (TimeoutError, _aiohttp.ClientConnectionError, _aiohttp.ClientResponseError) as e:
                should_retry = isinstance(e, (_aiohttp.ClientConnectionError, asyncio.TimeoutError)) or (
                    isinstance(e, _aiohttp.ClientResponseError) and e.status in (429, 500, 502, 503)
                )
                if should_retry and attempt < _MAX_RETRIES - 1:
                    delay = _RETRY_BASE_DELAY * (2**attempt)
                    logger.warning(f"[Ollama] 请求失败（第 {attempt + 1} 次），{delay:.1f}s 后重试: {e}")
                    await asyncio.sleep(delay)
                else:
                    raise

    def _build_messages_payload(self, req: ChatRequest) -> list[dict[str, Any]]:
        """构造 Ollama 对话消息 payload，支持 tool_calls 与 tool_call_id。"""
        messages_payload: list[dict[str, Any]] = []
        for m in req.messages:
            msg: dict[str, Any] = {"role": m.role}
            if m.content is not None:
                msg["content"] = m.content
            if m.tool_calls is not None:
                msg["tool_calls"] = m.tool_calls
            if m.tool_call_id is not None:
                msg["tool_call_id"] = m.tool_call_id
            messages_payload.append(msg)
        return messages_payload

    def _build_chat_options(self, req: ChatRequest) -> dict[str, Any]:
        """构造 Ollama /api/chat 请求体，按需附加 tools/tool_choice。"""
        data: dict[str, Any] = {
            "model": self._get_model(req.model),
            "messages": self._build_messages_payload(req),
            "options": {"temperature": req.temperature},
        }
        if req.tools:
            data["tools"] = req.tools
            if req.tool_choice is not None:
                data["tool_choice"] = req.tool_choice
        return data

    @staticmethod
    def _parse_ollama_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]] | None:
        """从 Ollama 响应 message 中解析 tool_calls。"""
        raw_tool_calls = message.get("tool_calls")
        if not raw_tool_calls:
            return None
        tool_calls: list[dict[str, Any]] = []
        for tc in raw_tool_calls:
            function_info = tc.get("function", {})
            tool_calls.append(
                {
                    "id": tc.get("id", ""),
                    "type": tc.get("type", "function"),
                    "function": {
                        "name": function_info.get("name", ""),
                        "arguments": function_info.get("arguments", ""),
                    },
                }
            )
        return tool_calls

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
        data = self._build_chat_options(req)
        data["stream"] = False
        resp = await self._post("chat", data)
        try:
            message = resp["message"]
            content = message.get("content", "")
            model = resp.get("model", self._get_model(req.model))
            tool_calls = self._parse_ollama_tool_calls(message)
        except (KeyError, TypeError) as e:
            raise ValueError(f"解析 Ollama 响应失败: {e}, 响应: {resp}") from e
        return ChatResponse(content=content or "", tool_calls=tool_calls, model=model)

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

        data = self._build_chat_options(req)
        data["stream"] = True
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

    def _resolve_context_window(self, model: str | None) -> int | None:
        """
        @methoddesc 通过 Ollama /api/show 同步探测模型的上下文窗口

        查询本地 Ollama 服务获取模型真实 context_length，按模型名缓存到实例。
        探测失败（服务不可达、响应格式异常、字段缺失）时静默返回 None，
        由基类 get_context_window 回退到全局默认值。

        使用标准库 urllib 发起同步请求（Ollama 通常运行在 localhost，延迟极低），
        避免引入 requests 等额外依赖，也避免在同步调用上下文中处理 async。

        Args:
            model: 模型名称，None 则使用配置中的默认模型

        Returns:
            探测到的上下文窗口大小（tokens），探测不到返回 None
        """
        model_name = (model or self.cfg.model).strip()
        if not model_name:
            return None

        # 命中缓存直接返回
        if model_name in self._context_window_cache:
            return self._context_window_cache[model_name]

        url = f"{self.cfg.base_url}/api/show"
        payload = json.dumps({"name": model_name}).encode("utf-8")

        try:
            import urllib.request

            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:  # noqa: S310
                data = json.loads(resp.read().decode("utf-8"))

            # Ollama /api/show 返回的 context_length 位置优先级：
            # 1. model_info."llama.context_length"（GPTForCausalLM 等架构）
            # 2. model_info."<arch>.context_length"（通用键名后缀匹配）
            # 3. 顶层 parameters 里的 num_ctx（部分版本）
            model_info = data.get("model_info", {}) or {}
            context_length = self._extract_context_length(model_info)
            if context_length is None:
                # 部分旧版 Ollama 在 parameters 中暴露 num_ctx
                params = data.get("parameters", "")
                context_length = self._parse_num_ctx(params)

            if context_length and context_length > 0:
                self._context_window_cache[model_name] = context_length
                return context_length

            logger.debug("Ollama /api/show 未返回有效的 context_length: model=%s", model_name)
            return None
        except Exception as e:
            # 探测失败是预期内的降级路径（服务未启动/模型未拉取），仅记 debug 日志
            logger.debug("Ollama 上下文窗口探测失败，将回退到默认值: model=%s, error=%s", model_name, e)
            return None

    @staticmethod
    def _extract_context_length(model_info: dict) -> int | None:
        """
        @methoddesc 从 Ollama model_info 中提取 context_length

        Ollama 的键名因模型架构而异（如 llama.context_length、qwen2.context_length），
        统一按后缀 ".context_length" 匹配。

        Args:
            model_info: /api/show 返回的 model_info 字典

        Returns:
            context_length 值，未找到返回 None
        """
        for key, value in model_info.items():
            if key.endswith(".context_length") and isinstance(value, (int, float)):
                return int(value)
        return None

    @staticmethod
    def _parse_num_ctx(parameters: str | None) -> int | None:
        """
        @methoddesc 从 Ollama parameters 字符串中解析 num_ctx

        parameters 形如 "num_ctx\t8192\\nstop\t<...>"，解析 num_ctx 行。

        Args:
            parameters: /api/show 返回的 parameters 字符串

        Returns:
            num_ctx 值，未找到或格式异常返回 None
        """
        if not parameters:
            return None
        for line in parameters.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0] == "num_ctx":
                try:
                    return int(parts[1])
                except ValueError:
                    return None
        return None

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
