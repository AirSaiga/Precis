"""
@fileoverview AI Chat LLM 服务模块

功能概述:
- 提供统一的同步 LLM 调用接口，屏蔽底层 Provider 差异
- 支持非流式对话、流式对话、系统提示词对话
- 支持结构化 JSON 输出（通过 response_format）
- 兼容同步和异步上下文调用（自动判断事件循环）

架构设计:
- 门面模式：ChatLLMService 封装 Provider 创建和调用细节
- 与 Provider 架构联动：内部使用 registry.create() 实例化 Provider
- 同步包装异步：_run_async() 协程适配器支持在同步代码中调用异步 Provider

输入示例:
    service = ChatLLMService(
        provider_id="openai", name="OpenAI",
        provider_type=ProviderType.OPENAI,
        api_key="sk-xxx", base_url="https://api.openai.com/v1",
        model="gpt-4"
    )
    response = service.chat([
        {"role": "system", "content": "你是一个助手"},
        {"role": "user", "content": "你好"}
    ])

输出示例:
    "你好！有什么可以帮您的？"

    # 流式输出
    full = service.chat_stream(messages, on_chunk=lambda c: print(c, end=""))
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.providers import create
from app.shared.services.llm.providers.base import ChatMessage, ChatRequest

logger = logging.getLogger(__name__)


def _run_async(coro):
    """
    @methoddesc 在同步或异步上下文中安全运行协程

    这是一个协程适配器，用于让同步代码也能调用异步 Provider。
    - 如果当前没有事件循环，直接用 asyncio.run() 运行
    - 如果已有事件循环（如在异步上下文中），则在线程池中运行

    参数:
        coro: 要执行的协程对象

    返回:
        协程的返回值

    注意:
        在异步上下文中调用同步方法里的异步代码时，会发出 DeprecationWarning。
        建议直接使用 async_chat() 等异步方法。
    """
    try:
        # 检查当前是否已有运行中的事件循环
        asyncio.get_running_loop()
    except RuntimeError:
        # 没有事件循环，直接运行
        return asyncio.run(coro)
    else:
        # 已有事件循环，在线程池中运行以避免冲突
        import warnings

        warnings.warn(
            "Calling async code from sync method in async context is not recommended. "
            "Consider using async_chat() instead.",
            DeprecationWarning,
            stacklevel=4,
        )
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result()


class ChatLLMService:
    """
    @classdesc AI Chat LLM 服务类

    提供统一的同步接口调用各种 LLM 提供商。
    封装了 Provider 创建、消息转换、同步/异步适配等底层细节。
    """

    def __init__(
        self,
        provider_id: str,
        name: str,
        provider_type: ProviderType,
        api_key: str,
        base_url: str,
        model: str,
    ) -> None:
        """
        初始化 Chat LLM 服务

        Args:
            provider_id: Provider 唯一标识
            name: Provider 显示名称
            provider_type: Provider 类型（OPENAI/OLLAMA）
            api_key: API Key
            base_url: API 端点
            model: 模型名称
        """
        self._config = AIProvider(
            id=provider_id,
            name=name,
            type=provider_type,
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
        self._client = None

    @property
    def client(self):
        """
        @methoddesc 获取或创建 Provider 客户端

        懒加载模式：首次访问时通过 registry.create() 创建 Provider 实例。
        """
        if self._client is None:
            self._client = create(self._config)
        return self._client

    def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        response_format: dict[str, str] | None = None,
    ) -> str:
        """
        @methoddesc 发送非流式聊天请求

        将字典格式的消息列表转换为 ChatMessage 对象，调用底层 Provider，
        并返回 AI 回复的纯文本内容。

        参数:
            messages: 对话消息列表，每条为 {"role": "user", "content": "..."}
            temperature: 采样温度（0~1），None 则使用默认值 0.7
            response_format: 响应格式（用于结构化 JSON 输出），当前版本预留参数

        返回:
            AI 回复的文本内容

        异常:
            Exception: Provider 调用失败时抛出
        """
        # 将字典消息转换为 ChatMessage 对象列表
        chat_messages = [ChatMessage(role=m["role"], content=m["content"]) for m in messages]
        req = ChatRequest(
            messages=chat_messages,
            model=self._config.model,
            temperature=temperature if temperature is not None else 0.7,
        )

        logger.debug(f"Chat request: model={self._config.model}, messages={len(messages)}")
        try:
            response = _run_async(self.client.chat(req))
            logger.debug(f"Chat response: length={len(response.content)}")
            return response.content
        except Exception as e:
            logger.error(f"Chat request failed: {e}")
            raise

    def chat_with_system_prompt(
        self,
        system_prompt: str,
        user_message: str,
        temperature: float = 0.1,
    ) -> str:
        """
        @methoddesc 使用系统提示词发送聊天请求

        快捷方法，自动组装 system + user 消息结构后调用 chat()。

        参数:
            system_prompt: 系统提示词
            user_message: 用户消息
            temperature: 温度参数

        返回:
            AI 回复内容
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]
        return self.chat(messages, temperature=temperature)

    def chat_stream(
        self,
        messages: list[dict[str, str]],
        temperature: float | None = None,
        on_progress: Callable[[int], None] | None = None,
        on_chunk: Callable[[str], None] | None = None,
    ) -> str:
        """
        @methoddesc 发送流式聊天请求，支持实时回调

        流式输出适合需要实时显示 AI 回复的场景（如打字机效果）。
        内部通过异步生成器逐块收集内容，同时触发用户提供的回调函数。

        参数:
            messages: 对话消息列表，每条为 {"role": "user", "content": "..."}
            temperature: 采样温度（0~1），None 则使用默认值 0.7
            on_progress: 进度回调函数，参数为累计字符数（可用于更新进度条）
            on_chunk: 内容块回调函数，参数为当前收到的文本块（可用于实时渲染）

        返回:
            拼接后的完整 AI 回复文本

        异常:
            Exception: Provider 调用失败时抛出
        """
        # 构建请求对象
        chat_messages = [ChatMessage(role=m["role"], content=m["content"]) for m in messages]
        req = ChatRequest(
            messages=chat_messages,
            model=self._config.model,
            temperature=temperature if temperature is not None else 0.7,
        )

        logger.debug(f"Chat stream request: model={self._config.model}, messages={len(messages)}")
        try:
            result = []
            char_count = 0

            # 内部异步函数：逐块收集流式响应
            async def collect_stream():
                nonlocal char_count
                async for chunk in self.client.chat_stream(req):
                    result.append(chunk)
                    char_count += len(chunk)
                    if on_chunk:
                        on_chunk(chunk)
                    if on_progress:
                        on_progress(char_count)

            _run_async(collect_stream())

            full_response = "".join(result)
            logger.debug(f"Chat stream response: length={len(full_response)}")
            return full_response
        except Exception as e:
            logger.error(f"Chat stream request failed: {e}")
            raise


class ChatLLMServiceFactory:
    """
    @classdesc Chat LLM 服务工厂类

    根据提供商类型创建对应的 LLM 服务实例。
    Provider 元数据（URL、默认模型、显示名称）集中在此字典中管理，
    避免硬编码分散在各 create_* 方法中。
    """

    PROVIDER_CONFIGS: dict[str, dict[str, str]] = {
        "glm": {
            "name": "智谱 GLM",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "default_model": "glm-4-flash",
        },
        "minimax": {
            "name": "MiniMax",
            "base_url": "https://api.minimax.chat/v1",
            "default_model": "abab6.5s-chat",
        },
        "kimi": {
            "name": "Kimi",
            "base_url": "https://api.moonshot.cn/v1",
            "default_model": "kimi-chat",
        },
        "deepseek": {
            "name": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "default_model": "deepseek-chat",
        },
        "qwen": {
            "name": "通义千问",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "default_model": "qwen-turbo",
        },
        "openai": {
            "name": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "default_model": "gpt-4o",
        },
    }

    @classmethod
    def _create_from_config(
        cls, provider_id: str, api_key: str, model: str | None = None, base_url: str | None = None
    ) -> ChatLLMService:
        """
        @methoddesc 根据 Provider ID 和内置配置创建 ChatLLMService

        参数:
            provider_id: Provider 标识（如 "openai", "deepseek"）
            api_key: API 密钥
            model: 模型名称，None 则使用内置默认值
            base_url: API 基础 URL，None 则使用内置默认值

        返回:
            ChatLLMService 实例

        异常:
            ValueError: 未知的 Provider ID
        """
        config = cls.PROVIDER_CONFIGS.get(provider_id)
        if not config:
            raise ValueError(f"Unknown provider: {provider_id}")

        return ChatLLMService(
            provider_id=provider_id,
            name=config["name"],
            provider_type=ProviderType.OPENAI,
            api_key=api_key,
            base_url=base_url or config["base_url"],
            model=model or config["default_model"],
        )

    @classmethod
    def create_glm(cls, api_key: str, model: str = "glm-4-flash") -> ChatLLMService:
        """创建智谱 GLM 服务实例"""
        return cls._create_from_config("glm", api_key, model)

    @classmethod
    def create_minimax(cls, api_key: str, model: str = "abab6.5s-chat") -> ChatLLMService:
        """创建 MiniMax 服务实例"""
        return cls._create_from_config("minimax", api_key, model)

    @classmethod
    def create_kimi(cls, api_key: str, model: str = "kimi-chat") -> ChatLLMService:
        """创建 Kimi 服务实例"""
        return cls._create_from_config("kimi", api_key, model)

    @classmethod
    def create_deepseek(cls, api_key: str, model: str = "deepseek-chat") -> ChatLLMService:
        """创建 DeepSeek 服务实例"""
        return cls._create_from_config("deepseek", api_key, model)

    @classmethod
    def create_qwen(cls, api_key: str, model: str = "qwen-turbo") -> ChatLLMService:
        """创建通义千问服务实例"""
        return cls._create_from_config("qwen", api_key, model)

    @classmethod
    def create_openai(cls, api_key: str, model: str = "gpt-4o") -> ChatLLMService:
        """创建 OpenAI 服务实例"""
        return cls._create_from_config("openai", api_key, model)

    @classmethod
    def create_from_config(
        cls,
        provider: str,
        api_key: str,
        base_url: str | None = None,
        model: str | None = None,
    ) -> ChatLLMService:
        """根据 Provider 名称自动匹配并创建 ChatLLMService"""
        provider_lower = provider.lower()

        if "glm" in provider_lower or "zhipu" in provider_lower:
            return cls.create_glm(api_key, model or "glm-4-flash")
        elif "minimax" in provider_lower:
            return cls.create_minimax(api_key, model or "abab6.5s-chat")
        elif "kimi" in provider_lower or "moonshot" in provider_lower:
            return cls.create_kimi(api_key, model or "kimi-chat")
        elif "deepseek" in provider_lower:
            return cls.create_deepseek(api_key, model or "deepseek-chat")
        elif "qwen" in provider_lower or "ali" in provider_lower or "alibaba" in provider_lower:
            return cls.create_qwen(api_key, model or "qwen-turbo")
        elif "ollama" in provider_lower:
            return ChatLLMService(
                provider_id="ollama",
                name="Ollama",
                provider_type=ProviderType.OLLAMA,
                api_key=api_key,
                base_url=base_url or "http://localhost:11434",
                model=model or "",
            )
        elif "openai" in provider_lower:
            if base_url:
                return ChatLLMService(
                    provider_id="openai-custom",
                    name="OpenAI Custom",
                    provider_type=ProviderType.OPENAI,
                    api_key=api_key,
                    base_url=base_url,
                    model=model or "gpt-4o",
                )
            return cls.create_openai(api_key, model or "gpt-4o")
        else:
            return ChatLLMService(
                provider_id="custom",
                name="Custom",
                provider_type=ProviderType.OPENAI,
                api_key=api_key,
                base_url=base_url or "",
                model=model or "",
            )
