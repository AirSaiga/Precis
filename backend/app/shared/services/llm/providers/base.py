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

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from ..config.models import AIProvider


@dataclass
class ChatMessage:
    """单条对话消息

    Attributes:
        role: 消息角色，如 "system"（系统）、"user"（用户）、"assistant"（AI助手）
        content: 消息文本内容
    """

    role: str
    content: str


@dataclass
class ChatRequest:
    """对话请求参数

    Attributes:
        messages: 对话消息列表（至少包含一条用户消息）
        model: 指定使用的模型名称，None 则使用 Provider 配置的默认模型
        stream: 是否启用流式输出（True 时逐字返回，False 时一次性返回）
        temperature: 采样温度（0~1 之间），值越低输出越确定，越高越有创造性
    """

    messages: list[ChatMessage]
    model: str = None
    stream: bool = False
    temperature: float = 0.7


@dataclass
class ChatResponse:
    """对话响应结果

    Attributes:
        content: AI 回复的文本内容
        model: 实际使用的模型名称
    """

    content: str
    model: str = None


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
    async def chat_stream(self, req: ChatRequest) -> AsyncIterator[str]:
        """
        @methoddesc 流式对话
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

    def _get_model(self, override: str = None) -> str:
        """
        @methoddesc 获取实际使用的模型名称

        如果用户指定了覆盖值，则使用覆盖值；否则使用配置中的默认模型。
        """
        return override or self.cfg.model
