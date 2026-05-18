"""
@fileoverview CLI AI 配置存储模块

功能概述:
- 适配 LLM 配置系统，管理 ~/.precis/ai_providers.yaml
- 提供 Provider 的增删改查与默认设置切换
- 支持配置热重载

架构设计:
- CLIConfigStorage 封装 AIConfig 的加载与持久化
- CLIProviderConfig 作为兼容层桥接新旧配置模型
- 单例模式通过 get_cli_config() 提供全局访问
"""

from __future__ import annotations

from dataclasses import dataclass

from app.shared.services.llm.config.loader import loader
from app.shared.services.llm.config.models import AIConfig, AIProvider, ProviderType


@dataclass
class CLIProviderConfig:
    """CLI Provider 配置数据类（兼容层）"""

    id: str
    name: str
    provider: str  # 映射到 type
    base_url: str
    model: str
    api_key: str
    enabled: bool = True
    supports_custom_model: bool = False

    @classmethod
    def from_ai_provider(cls, p: AIProvider) -> CLIProviderConfig:
        """从新的 AIProvider 创建"""
        # type 可能是字符串或 ProviderType 枚举
        type_str = p.type if isinstance(p.type, str) else p.type.value
        return cls(
            id=p.id,
            name=p.name,
            provider=type_str,
            base_url=p.base_url,
            model=p.model,
            api_key=p.api_key or "",
            enabled=True,
            supports_custom_model=type_str == "openai",
        )


class CLIConfigStorage:
    """CLI 配置存储管理类（适配新的配置系统）"""

    def __init__(self):
        self._config: AIConfig = None
        self._load()

    def _load(self) -> None:
        """从文件加载配置"""
        try:
            self._config = loader.load()
        except Exception:
            self._config = AIConfig()

    def _save(self) -> None:
        """保存配置到文件"""
        loader.save(self._config)

    def get_provider(self, provider_id: str) -> CLIProviderConfig | None:
        """获取指定 Provider"""
        for p in self._config.providers:
            if p.id == provider_id:
                return CLIProviderConfig.from_ai_provider(p)
        return None

    def get_active_provider(self) -> CLIProviderConfig | None:
        """获取当前活动的 Provider"""
        # 从 defaults 中获取默认 chat provider
        default_id = self._config.defaults.get("chat")
        if default_id:
            return self.get_provider(default_id)
        # 如果没有设置，返回第一个
        if self._config.providers:
            return CLIProviderConfig.from_ai_provider(self._config.providers[0])
        return None

    def set_active_provider(self, provider_id: str) -> bool:
        """设置活动 Provider"""
        if not any(p.id == provider_id for p in self._config.providers):
            return False
        self._config.defaults["chat"] = provider_id
        self._save()
        return True

    def add_or_update_provider(self, provider: CLIProviderConfig) -> None:
        """添加或更新 Provider"""
        # 转换为 AIProvider
        provider_type = ProviderType.OLLAMA if provider.provider == "ollama" else ProviderType.OPENAI
        ai_provider = AIProvider(
            id=provider.id,
            name=provider.name,
            type=provider_type,
            base_url=provider.base_url,
            api_key=provider.api_key or None,
            model=provider.model,
        )

        # 查找并替换或添加
        for i, p in enumerate(self._config.providers):
            if p.id == provider.id:
                self._config.providers[i] = ai_provider
                break
        else:
            self._config.providers.append(ai_provider)

        # 如果是第一个 provider，设为默认
        if len(self._config.providers) == 1:
            self._config.defaults["chat"] = provider.id

        self._save()

    def list_providers(self) -> list[CLIProviderConfig]:
        """列出所有 Providers"""
        return [CLIProviderConfig.from_ai_provider(p) for p in self._config.providers]

    def has_configured_provider(self) -> bool:
        """检查是否有已配置的 Provider（有 API Key）"""
        for p in self._config.providers:
            if p.api_key:
                return True
        return False

    def delete_provider(self, provider_id: str) -> bool:
        """删除 Provider"""
        original_len = len(self._config.providers)
        self._config.providers = [p for p in self._config.providers if p.id != provider_id]
        if len(self._config.providers) < original_len:
            if self._config.defaults.get("chat") == provider_id:
                self._config.defaults["chat"] = ""
            self._save()
            return True
        return False


# 全局配置存储实例
_cli_config = None


def get_cli_config() -> CLIConfigStorage:
    """获取 CLI 配置存储实例（单例）"""
    global _cli_config
    if _cli_config is None:
        _cli_config = CLIConfigStorage()
    return _cli_config


def reload_providers_config() -> bool:
    """重新加载 Provider 配置"""
    global _cli_config
    if _cli_config:
        _cli_config._load()
    return True
