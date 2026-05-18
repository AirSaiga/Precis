"""
@fileoverview LLM 对话与响应解析子包

功能概述:
- ChatLLMService: 统一的同步 LLM 调用接口
- ChatLLMServiceFactory: 多 Provider 工厂
- build_system_prompt: 系统提示词构建
- ActionParser: LLM JSON 响应解析器

架构设计:
- 门面模式: ChatLLMService 封装 Provider 调用细节
- 工厂模式: ChatLLMServiceFactory 根据 Provider 类型创建服务
"""

from app.shared.services.llm.chat.chat_service import ChatLLMService, ChatLLMServiceFactory
from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt
from app.shared.services.llm.chat.response_parser import ActionParser

__all__ = [
    "ActionParser",
    "ChatLLMService",
    "ChatLLMServiceFactory",
    "build_system_prompt",
]
