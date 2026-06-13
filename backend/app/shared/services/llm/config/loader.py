"""
@fileoverview AI 配置加载器

功能概述:
- 从 ~/.precis/ai_providers.yaml 加载 AI Provider 配置
- 支持环境变量 ${VAR} 递归替换
- API Key 加密存储（Fernet 对称加密）
- 配置版本检查（仅兼容 2.x）
- 首次使用自动创建默认配置模板
- mtime 缓存避免重复文件读取

设计原则:
- AI Provider 配置是用户级全局设置，不属于项目仓库
- 统一固定读取 ~/.precis/ai_providers.yaml
- save() 始终写入用户级路径
- api_key 加密存储：YAML 中以 "enc:" 前缀标记加密值
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

from app.shared.core.config import ConfigPaths

from .crypto import decrypt_api_key, encrypt_api_key, is_encrypted
from .models import AIConfig


class ConfigLoader:
    """
    @classdesc 配置加载器 - 只支持 v2.0

    AI Provider 配置固定存放在用户级路径 ~/.precis/ai_providers.yaml，
    不再支持项目级或系统级配置查找。
    """

    CONFIG_FILENAME = "ai_providers.yaml"

    _cached_config: AIConfig | None = None
    _cached_mtime: float | None = None

    def __init__(self, config_path: Path | None = None):
        """
        @methoddesc 初始化配置加载器

        参数:
            config_path: 可选，自定义配置文件路径。主要用于测试。
                         未提供时固定使用 ~/.precis/ai_providers.yaml。
        """
        self._config_path = config_path

    @property
    def config_path(self) -> Path:
        """用户级 AI 配置文件路径（唯一真相源）"""
        if self._config_path is not None:
            return self._config_path
        return ConfigPaths.ai_providers()

    @config_path.setter
    def config_path(self, value: Path) -> None:
        """允许测试注入自定义路径。"""
        self._config_path = value

    @property
    def USER_PATH(self) -> Path:  # noqa: N802
        """用户级配置路径（save 的写入目标）"""
        return self.config_path

    def _expand_env(self, value: any) -> any:
        """
        @methoddesc 递归替换字符串中的环境变量 ${VAR}

        支持字符串、字典、列表的递归处理。
        如果环境变量不存在，替换为空字符串。
        """
        if isinstance(value, str):
            return re.sub(r"\$\{([^}]+)\}", lambda m: os.getenv(m.group(1), ""), value)
        elif isinstance(value, dict):
            return {k: self._expand_env(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [self._expand_env(v) for v in value]
        return value

    def _decrypt_api_keys(self, data: any) -> any:
        """递归解密 api_key 字段中的加密值。"""
        if isinstance(data, dict):
            result = {}
            for k, v in data.items():
                if k == "api_key" and isinstance(v, str) and is_encrypted(v):
                    result[k] = decrypt_api_key(v)
                else:
                    result[k] = self._decrypt_api_keys(v)
            return result
        elif isinstance(data, list):
            return [self._decrypt_api_keys(item) for item in data]
        return data

    def _encrypt_api_keys(self, data: any) -> any:
        """递归加密 api_key 字段中的明文值。"""
        if isinstance(data, dict):
            result = {}
            for k, v in data.items():
                if k == "api_key" and isinstance(v, str) and v and not is_encrypted(v) and not re.search(r"\$\{", v):
                    result[k] = encrypt_api_key(v)
                else:
                    result[k] = self._encrypt_api_keys(v)
            return result
        elif isinstance(data, list):
            return [self._encrypt_api_keys(item) for item in data]
        return data

    def load(self) -> AIConfig:
        """
        @methoddesc 加载 AI Provider 配置文件

        固定读取 ~/.precis/ai_providers.yaml。
        文件不存在时自动创建默认模板并返回。
        """
        config_path = self.config_path

        if self._cached_config is not None and config_path.exists():
            try:
                current_mtime = config_path.stat().st_mtime
                if current_mtime == self._cached_mtime:
                    return self._cached_config
            except OSError:
                pass

        if not config_path.exists():
            config = self._create_default()
            self.save(config)
            return config

        with open(config_path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        version = data.get("version", "unknown")
        if not isinstance(version, str) or not version.startswith("2."):
            raise ValueError(f"Unsupported config version: {version}, expected 2.x")

        data = self._expand_env(data)
        data = self._decrypt_api_keys(data)
        config = AIConfig(**data)
        self._load_api_keys_from_env(config)

        try:
            self._cached_mtime = config_path.stat().st_mtime
            self._cached_config = config
        except OSError:
            pass

        return config

    def _load_api_keys_from_env(self, config: AIConfig) -> None:
        """从环境变量读取 API Key（优先级高于配置文件）。"""
        for provider in config.providers:
            env_key = f"{provider.id.upper().replace('-', '_')}_API_KEY"
            api_key = os.getenv(env_key)

            if not api_key:
                provider_type = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
                env_key = f"{provider_type.upper()}_API_KEY"
                api_key = os.getenv(env_key)

            if api_key:
                provider.api_key = api_key

    def save(self, config: AIConfig):
        """
        @methoddesc 将配置保存到用户级 YAML 文件

        始终写入 ~/.precis/ai_providers.yaml。
        """
        user_path = self.config_path
        user_path.parent.mkdir(parents=True, exist_ok=True)

        data = config.model_dump(exclude_none=True)
        data = self._encrypt_api_keys(data)

        with open(user_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        self.invalidate_cache()

    def invalidate_cache(self):
        """清除缓存，强制下次 load() 重新读取文件"""
        self._cached_config = None
        self._cached_mtime = None

    def _create_default(self) -> AIConfig:
        """创建默认配置模板（DeepSeek + Ollama Local）。"""
        return AIConfig(
            providers=[
                {
                    "id": "deepseek",
                    "name": "DeepSeek",
                    "type": "openai",
                    "base_url": "https://api.deepseek.com",
                    "api_key": "${DEEPSEEK_API_KEY}",
                    "model": "deepseek-v4-pro",
                },
                {
                    "id": "ollama-local",
                    "name": "Ollama Local",
                    "type": "ollama",
                    "base_url": "http://localhost:11434",
                    "api_key": None,
                    "model": "llama3.2",
                },
            ],
            defaults={"chat": "deepseek"},
        )


# 全局实例
loader = ConfigLoader()
