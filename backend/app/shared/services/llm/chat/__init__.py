"""
@fileoverview LLM 对话与响应解析子包

功能概述:
- ChatLLMService: 统一的同步 LLM 调用接口
- build_system_prompt: 系统提示词构建
- ActionParser: LLM JSON 响应解析器

架构设计:
- 门面模式: ChatLLMService 封装 Provider 调用细节
- 直接接收 AIProvider 配置，通过 registry.create() 创建 Provider
"""

from app.shared.services.llm.chat.chat_service import ChatLLMService
from app.shared.services.llm.chat.chat_system_prompt import build_system_prompt
from app.shared.services.llm.chat.response_parser import ActionParser

__all__ = [
    "ActionParser",
    "ChatLLMService",
    "build_system_prompt",
]
