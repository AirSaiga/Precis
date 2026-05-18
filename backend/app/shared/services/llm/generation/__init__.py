"""@fileoverview LLM 配置生成服务模块入口

功能概述:
- 导出配置生成服务（ConfigGenerationService）及选项类
- 供上层业务调用以生成 Precis 项目配置

架构设计:
- 聚合导出 service.py 中的公共类和异常
- 通过 __all__ 控制对外暴露的接口

输入示例:
    from app.shared.services.llm.generation import ConfigGenerationService, GenerationOptions

输出示例:
    service = ConfigGenerationService(provider_id="openai")
    result = await service.generate(...)
"""

from .service import CancelledError, ConfigGenerationService, GenerationOptions, GenerationParseError, ProfilingOptions

__all__ = [
    "ConfigGenerationService",
    "GenerationOptions",
    "ProfilingOptions",
    "CancelledError",
    "GenerationParseError",
]
