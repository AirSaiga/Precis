"""
@fileoverview Provider 抽象基类

功能概述:
- 定义所有 AI Provider 必须实现的抽象接口
- 定义对话消息、请求、响应的数据结构（ChatMessage、ChatRequest、ChatResponse）
- 提供模型名称选择逻辑（用户覆盖或配置默认）

架构设计:
- 抽象基类模式：BaseProvider 为 ABC，子类必须实现 chat、chat_stream、list_models、health
- Dataclass 定义消息契约，轻量且无外部依赖
- 与 AIProvider 配置模型解耦：基类只关心运行时行为

输入示例:
    req = ChatRequest(
        messages=[ChatMessage(role="user", content="你好")],
        model="gpt-4",
        temperature=0.7
    )

输出示例:
    resp = await provider.chat(req)
    # ChatResponse(content="你好！有什么可以帮您的？", model="gpt-4")
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from ..config.models import AIProvider

# 用户未指定 context_window 且无法自动探测时的全局回退值。
# 云厂商的 /v1/models 接口普遍不暴露 context window，因此无法零维护地自动获取；
# 统一使用一个保守而通用的回退值，避免维护易过期的硬编码模型表。
DEFAULT_FALLBACK_CONTEXT_WINDOW = 200000


@dataclass
class ChatMessage:
    """单条对话消息

    Attributes:
        role: 消息角色，如 "system"（系统）、"user"（用户）、"assistant"（AI助手）、"tool"（工具结果）
        content: 消息文本内容
        tool_calls: assistant 消息中的工具调用请求列表（OpenAI tools 协议）
        tool_call_id: tool 角色消息对应的工具调用 ID
    """

    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None


@dataclass
class ChatRequest:
    """对话请求参数

    Attributes:
        messages: 对话消息列表（至少包含一条用户消息）
        model: 指定使用的模型名称，None 则使用 Provider 配置的默认模型
        stream: 是否启用流式输出（True 时逐字返回，False 时一次性返回）
        temperature: 采样温度（0~1 之间），值越低输出越确定，越高越有创造性
        tools: OpenAI tools 定义列表，用于 function calling
        tool_choice: 工具选择策略，如 "auto"、"none" 或指定某个工具
    """

    messages: list[ChatMessage]
    model: str | None = None
    stream: bool = False
    temperature: float = 0.7
    tools: list[dict[str, Any]] | None = None
    tool_choice: str | dict[str, Any] | None = None


@dataclass
class ChatResponse:
    """对话响应结果

    Attributes:
        content: AI 回复的文本内容
        tool_calls: AI 请求调用的工具列表（OpenAI tools 协议）
        model: 实际使用的模型名称
    """

    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    model: str | None = None


class BaseProvider(ABC):
    """
    @classdesc Provider 抽象基类

    定义所有 AI Provider 必须实现的抽象接口。
    子类必须实现 chat、chat_stream、list_models、health 四个方法。

    设计原则：
    - 统一接口：所有 Provider 提供相同的调用方式
    - 与配置解耦：基类只关心运行时行为
    - 模型选择：提供 _get_model 方法处理用户覆盖和配置默认
    """

    def __init__(self, config: AIProvider):
        self.cfg = config

    @property
    @abstractmethod
    def name(self) -> str:
        """
        @methoddesc Provider 显示名称
        """
        pass

    @abstractmethod
    async def chat(self, req: ChatRequest) -> ChatResponse:
        """
        @methoddesc 非流式对话
        """
        pass

    @abstractmethod
    def chat_stream(self, req: ChatRequest) -> AsyncIterator[StreamChunk]:
        """
        @methoddesc 流式对话

        所有 Provider 必须返回 AsyncIterator[StreamChunk] 统一输出契约。
        """
        pass

    @abstractmethod
    async def list_models(self) -> list[str]:
        """
        @methoddesc 获取可用模型列表
        """
        pass

    @abstractmethod
    async def health(self) -> dict[str, Any]:
        """
        @methoddesc 健康检查

        返回:
            {"status": "ok|error", ...}
        """
        pass

    def _get_model(self, override: str | None = None) -> str:
        """
        @methoddesc 获取实际使用的模型名称

        如果用户指定了覆盖值，则使用覆盖值；否则使用配置中的默认模型。
        """
        return override or self.cfg.model

    def get_context_window(self, model: str | None = None) -> int:
        """
        @methoddesc 获取指定模型的上下文窗口大小

        三层优先级：
        1. AIProvider 配置中显式指定的 context_window（用户输入，权威）
        2. 子类实现的 _resolve_context_window() 自动探测（如 Ollama 查询本地服务）
        3. 全局回退值 DEFAULT_FALLBACK_CONTEXT_WINDOW（200000 tokens）

        Args:
            model: 模型名称，None 则使用配置中的默认模型

        Returns:
            上下文窗口大小（tokens）
        """
        if self.cfg.context_window is not None:
            return self.cfg.context_window

        resolved = self._resolve_context_window(model)
        if resolved is not None:
            return resolved
        return DEFAULT_FALLBACK_CONTEXT_WINDOW

    def _resolve_context_window(self, model: str | None) -> int | None:
        """
        @methoddesc 子类钩子：返回自动探测到的上下文窗口大小

        基类默认返回 None（不探测），由 get_context_window 回退到全局默认值。
        子类（如 OllamaProvider）可覆盖此方法，从 Provider 服务实时获取真实值。

        Args:
            model: 模型名称，None 则使用配置中的默认模型

        Returns:
            探测到的上下文窗口大小，探测不到则返回 None
        """
        return None


def get_context_window_for_provider(config: AIProvider, model: str | None = None) -> int:
    """
    @methoddesc 根据 AIProvider 配置获取上下文窗口大小（仅看配置，不探测）

    无需实例化 Provider 即可调用，适合 CLI 等只需要读取配置的场景。
    仅解析两层：用户配置的 context_window > 全局回退值。
    需要自动探测（如 Ollama）的场景应实例化对应 Provider 并调用 get_context_window()。

    Args:
        config: AIProvider 配置对象
        model: 模型名称（保留参数以兼容旧调用签名，当前实现未使用）

    Returns:
        上下文窗口大小（tokens）
    """
    if config.context_window is not None:
        return config.context_window
    return DEFAULT_FALLBACK_CONTEXT_WINDOW


def resolve_context_window(config: AIProvider, model: str | None = None) -> int:
    """
    @methoddesc 统一的上下文窗口解析入口（同步）

    适用于 CLI 等只持有 AIProvider 配置、无法直接拿到 Provider 实例的场景。
    根据配置类型实例化对应 Provider 并调用 get_context_window()，
    自动应用三层优先级（用户输入 > 自动探测 > 全局回退）。

    Args:
        config: AIProvider 配置对象
        model: 模型名称，None 则使用配置中的默认模型

    Returns:
        上下文窗口大小（tokens）

    说明:
        若用户已在配置中显式指定 context_window，直接返回，避免实例化 Provider。
        延迟导入 registry 以避免循环依赖。
    """
    if config.context_window is not None:
        return config.context_window

    from .registry import create

    provider = create(config)
    return provider.get_context_window(model)


@dataclass
class StreamChunk:
    """@classdesc chat_stream 的统一输出单元

    所有 Provider 的 chat_stream 必须返回 AsyncIterator[StreamChunk]。
    统一两边输出契约，上层 AgentExecutor 只消费此类型，不关心 Provider 差异。

    Attributes:
        type: "delta"(文本增量) 或 "tool_calls"(完整工具调用集，一次性产出)
        text: type="delta" 时的文本增量，其余为 None
        tool_calls: type="tool_calls" 时的 OpenAI 原始格式 tool_call dict 列表，
            格式与 parse_tool_call 期望一致: [{"id":..., "function":{"name":..., "arguments":"<json str>"}}],
            其余为 None。注意: 必须是原始 dict 而非项目内 ToolCall dataclass，
            以便直接喂给 registry.parse_tool_call() 复用。
    """

    type: str  # Literal["delta", "tool_calls"] 用 str 避免循环导入
    text: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
