"""
@fileoverview Provider 注册表

功能概述:
- 管理 ProviderType 到具体 Provider 实现类的映射
- 提供统一的 Provider 实例创建接口
- 自动注册内置 Provider（OpenAI、Ollama）

架构设计:
- 全局字典注册表：运行时动态注册/查询
- 工厂模式：create(config) 根据配置类型自动实例化对应 Provider
- 与 base.py 解耦：新增 Provider 只需在此注册即可

输入示例:
    from app.shared.services.llm.config.models import AIProvider, ProviderType
    config = AIProvider(id="test", name="Test", type=ProviderType.OPENAI, base_url="...", model="gpt-4")

输出示例:
    provider = create(config)
    # 返回 OpenAIProvider 实例（因为 config.type == ProviderType.OPENAI）
"""

from ..config.models import AIProvider, ProviderType
from .base import BaseProvider
from .cached_provider import CachedProvider
from .ollama import OllamaProvider
from .openai import OpenAIProvider

# 全局注册表：ProviderType -> Provider 类 的映射字典
_registry: dict[ProviderType, type[BaseProvider]] = {}


def register(type: ProviderType, cls: type[BaseProvider]):
    """
    @methoddesc 将 Provider 实现类注册到全局注册表中

    参数:
        type: Provider 类型枚举值（如 ProviderType.OPENAI）
        cls: 继承自 BaseProvider 的实现类

    示例：
        >>> register(ProviderType.OPENAI, OpenAIProvider)
    """
    _registry[type] = cls


def create(config: AIProvider) -> BaseProvider:
    """
    @methoddesc 根据配置创建对应的 Provider 实例

    工厂模式：根据 config.type 从注册表中查找实现类并实例化。
    如果全局 AIConfig 启用了缓存，则用 CachedProvider 包装。

    参数:
        config: AIProvider 配置对象

    返回:
        BaseProvider 子类实例（可能被 CachedProvider 包装）

    异常:
        ValueError: 未注册的 Provider 类型

    示例：
        >>> provider = create(config)
    """
    cls = _registry.get(config.type)
    if not cls:
        raise ValueError(f"Unknown provider type: {config.type}")
    real = cls(config)

    # 尝试从全局配置加载缓存设置
    try:
        from ..config import loader as _loader

        ai_config = _loader.load()
        cache_cfg = ai_config.cache
        if cache_cfg.enabled:
            from ..cache.response_cache import ResponseCache

            cache = ResponseCache(
                max_entries=cache_cfg.max_entries,
                ttl_seconds=cache_cfg.ttl_seconds,
            )
            return CachedProvider(real, cache, cache_cfg.cache_temperature_above_zero)
    except Exception:
        pass  # 配置加载失败时降级为无缓存

    return real


# 注册内置 Provider
register(ProviderType.OPENAI, OpenAIProvider)
register(ProviderType.OLLAMA, OllamaProvider)
