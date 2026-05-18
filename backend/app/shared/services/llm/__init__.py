"""
@fileoverview LLM 服务模块聚合导出

功能概述:
- 聚合导出 AI Provider 配置、Provider 实现、服务发现、配置生成等子模块
- 为上层业务提供统一的 LLM 服务入口

架构设计:
- 通过 __init__.py 聚合子模块公共接口，降低外部导入复杂度
- 遵循显式导出原则，使用 __all__ 控制公开 API
- 各子模块职责分离：config 负责配置，providers 负责调用，discovery 负责发现，generation 负责生成

输入示例:
    from app.shared.services.llm import AIConfig, BaseProvider, ConfigGenerationService

输出示例:
    AIConfig 实例可用于配置管理
    BaseProvider 子类可用于执行对话
    ConfigGenerationService 可用于生成项目配置
"""

from .config import AIConfig, AIProvider, DeploymentType, ProviderType, loader
from .discovery import DiscoveredService, scanner
from .generation import ConfigGenerationService, GenerationOptions, ProfilingOptions
from .providers import BaseProvider, ChatMessage, ChatRequest, ChatResponse, create

__all__ = [
    # 配置
    "AIConfig",
    "AIProvider",
    "ProviderType",
    "DeploymentType",
    "loader",
    # Provider
    "BaseProvider",
    "ChatMessage",
    "ChatRequest",
    "ChatResponse",
    "create",
    # 发现
    "scanner",
    "DiscoveredService",
    # 配置生成
    "ConfigGenerationService",
    "GenerationOptions",
    "ProfilingOptions",
]
