"""@fileoverview LLM Provider 模块入口

功能概述:
- 统一导出各 Provider 实现（OpenAIProvider、OllamaProvider）及注册表接口
- 为上层业务提供统一的 Provider 创建和调用入口

架构设计:
- 聚合导出 base、openai、ollama、registry 子模块的公共接口
- 遵循显式导出原则，使用 __all__ 控制公开 API
- 新增 Provider 只需在 registry.py 注册即可自动可用

输入示例:
    from app.shared.services.llm.providers import create, BaseProvider, ChatRequest

输出示例:
    provider = create(config)  # 根据配置自动实例化对应 Provider
"""

from .base import BaseProvider, ChatMessage, ChatRequest, ChatResponse
from .ollama import OllamaProvider
from .openai import OpenAIProvider
from .registry import create, register

__all__ = [
    "BaseProvider",
    "ChatMessage",
    "ChatRequest",
    "ChatResponse",
    "register",
    "create",
    "OpenAIProvider",
    "OllamaProvider",
]
