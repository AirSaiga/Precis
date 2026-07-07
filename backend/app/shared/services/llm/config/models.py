"""
@fileoverview AI Provider 配置模型

功能概述:
- 定义 AI Provider 的配置结构（AIProvider、AIConfig）
- 定义 Provider 类型枚举（ProviderType、DeploymentType）
- 定义网络配置模型（NetworkConfig）
- 支持根据 base_url 自动推断部署类型（本地/远程）

架构设计:
- 使用 Pydantic BaseModel 进行数据校验和序列化
- 字段验证器自动推断 deployment 字段
- 配置版本固定为 2.0，确保向前兼容

输入示例:
    # ~/.precis/ai_providers.yaml
    version: "2.0"
    providers:
      - id: ollama-local
        name: Ollama
        type: ollama
        base_url: http://localhost:11434
        api_key: null
        model: llama3.2

输出示例:
    AIConfig(
      version="2.0",
      providers=[AIProvider(id="ollama-local", ..., deployment=DeploymentType.LOCAL)],
      defaults={"chat": "ollama-local"}
    )
"""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProviderType(str, Enum):
    """
    @classdesc Provider 类型枚举

    定义支持的 AI Provider 类型：
    - OPENAI: OpenAI 兼容 API（云端/本地通用）
    - OLLAMA: Ollama 原生 API
    """

    OPENAI = "openai"  # OpenAI 兼容 API（云端/本地通用）
    OLLAMA = "ollama"  # Ollama 原生 API


class DeploymentType(str, Enum):
    """
    @classdesc 部署类型枚举

    根据 base_url 自动推断部署位置：
    - LOCAL: 本地（localhost/127.0.0.1）
    - REMOTE: 远程（内网/公网）
    """

    LOCAL = "local"  # 本地（localhost/127.0.0.1）
    REMOTE = "remote"  # 远程（内网/公网）


class NetworkConfig(BaseModel):
    """
    @classdesc 网络连接配置

    控制与 AI Provider 通信时的超时和 SSL 校验行为。

    Attributes:
        timeout: 请求超时时间（秒），范围 5~300，默认 60
        verify_ssl: 是否验证 SSL 证书，默认 True
    """

    model_config = ConfigDict(use_enum_values=True)

    timeout: int = Field(default=60, ge=5, le=300, description="请求超时时间（秒）")
    verify_ssl: bool = Field(default=True, description="是否验证 SSL 证书")


class AICacheConfig(BaseModel):
    """
    @classdesc LLM 响应缓存配置

    控制 CachedProvider 的缓存行为。默认关闭，显式开启才生效。

    Attributes:
        enabled: 是否启用缓存，默认 False
        ttl_seconds: 缓存条目过期时间（秒），默认 3600
        max_entries: 缓存最大条目数（LRU 驱逐），默认 100
        cache_temperature_above_zero: 是否缓存 temperature > 0 的请求，默认 False
    """

    model_config = ConfigDict(use_enum_values=True)

    enabled: bool = Field(default=False, description="是否启用 LLM 响应缓存")
    ttl_seconds: float = Field(default=3600, ge=1, description="缓存条目过期时间（秒）")
    max_entries: int = Field(default=100, ge=1, description="缓存最大条目数")
    cache_temperature_above_zero: bool = Field(default=False, description="是否缓存 temperature > 0 的请求")


class AIProvider(BaseModel):
    """
    @classdesc AI Provider 配置模型

    定义一个 LLM 服务提供者的完整配置信息。
    设计简化：所有核心字段必填，无向后兼容逻辑。

    Attributes:
        id: Provider 唯一标识符（如 "openai", "ollama-local"）
        name: 显示名称（用于界面展示）
        type: Provider 类型枚举（OPENAI 或 OLLAMA）
        base_url: API 基础 URL（如 https://api.openai.com/v1）
        api_key: API 密钥，本地服务可设为 null
        model: 默认使用的模型名称（如 "gpt-4", "llama3.2"）
        context_window: 模型最大上下文窗口（tokens），None 则自动推断
        deployment: 部署类型（LOCAL/REMOTE），根据 base_url 自动推断
        network: 网络连接配置（可选）
        meta: 额外元数据字典（可选）
    """

    model_config = ConfigDict(use_enum_values=True)

    id: str = Field(..., description="唯一标识")
    name: str = Field(..., description="显示名称")
    type: ProviderType = Field(..., description="Provider 类型")

    base_url: str = Field(..., description="API 基础 URL")
    api_key: str | None = Field(default=None, description="API 密钥（本地服务可为 null）")
    model: str = Field(..., description="默认模型名称")
    context_window: int | None = Field(
        default=None,
        ge=1024,
        description="模型最大上下文窗口（tokens），None 时由 Provider 根据模型名自动推断",
    )

    # 运行时推断字段（不序列化到配置文件）
    deployment: DeploymentType | None = Field(default=None, exclude=True, description="部署类型（自动推断）")

    # 可选扩展配置
    network: NetworkConfig | None = Field(default=None, description="网络配置")
    meta: dict[str, Any] | None = Field(default=None, description="额外元数据")

    @model_validator(mode="after")
    def _infer_deployment(self) -> "AIProvider":
        """
        @methoddesc 根据 base_url 推断部署类型

        如果 URL 中包含 localhost、127.0.0.1 等本地地址，
        则推断为 LOCAL，否则为 REMOTE。
        使用 model_validator 确保在所有字段初始化后执行。
        """
        if self.deployment is None:
            local_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"]
            if any(h in self.base_url for h in local_hosts):
                self.deployment = DeploymentType.LOCAL
            else:
                self.deployment = DeploymentType.REMOTE
        return self


class AIConfig(BaseModel):
    """
    @classdesc AI 配置根对象

    对应 ~/.precis/ai_providers.yaml 的完整配置结构。

    Attributes:
        version: 配置格式版本，固定为 "2.0"
        providers: 所有 AI Provider 的列表
        defaults: 各场景默认使用的 Provider ID，如 {"chat": "ollama-local", "generate": "openai"}
    """

    model_config = ConfigDict(use_enum_values=True)

    version: str = Field(default="2.0", description="配置版本号")
    providers: list[AIProvider] = Field(default_factory=list, description="Provider 列表")

    # 系统设置
    defaults: dict[str, str] = Field(
        default_factory=dict, description="各场景默认 Provider，如 {'chat': 'ollama-local'}"
    )

    # LLM 响应缓存配置（默认关闭）
    cache: AICacheConfig = Field(default_factory=AICacheConfig, description="LLM 响应缓存配置")
