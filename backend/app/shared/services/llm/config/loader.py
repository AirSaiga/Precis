# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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
from typing import Any

import yaml

from app.shared.core.config import ConfigPaths
from app.shared.core.io.yaml import write_yaml_atomic

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
        # §2.12: env 注入 api_key 的 provider id 集合（save 时剔除不落盘）
        self._env_sourced_providers: set[str] = set()

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

    def _expand_env(self, value: Any) -> Any:
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

    def _decrypt_api_keys(self, data: Any) -> Any:
        """递归解密 api_key 字段中的加密值。"""
        if isinstance(data, dict):
            result: dict[Any, Any] = {}
            for k, v in data.items():
                if k == "api_key" and isinstance(v, str) and is_encrypted(v):
                    result[k] = decrypt_api_key(v)
                else:
                    result[k] = self._decrypt_api_keys(v)
            return result
        elif isinstance(data, list):
            return [self._decrypt_api_keys(item) for item in data]
        return data

    def _encrypt_api_keys(self, data: Any) -> Any:
        """递归加密 api_key 字段中的明文值。"""
        if isinstance(data, dict):
            result: dict[Any, Any] = {}
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
        """从环境变量读取 API Key（优先级高于配置文件）。

        §2.12: 注入的同时记录 env 来源的 provider id——save() 据此把 env 来源的
        api_key 从落盘数据剔除，保持"env 覆盖是临时语义"；用户显式改 key 的路径
        调 mark_api_key_manual() 后正常落盘。
        """
        for provider in config.providers:
            env_key = f"{provider.id.upper().replace('-', '_')}_API_KEY"
            api_key = os.getenv(env_key)

            if not api_key:
                provider_type = provider.type.value if hasattr(provider.type, "value") else str(provider.type)
                env_key = f"{provider_type.upper()}_API_KEY"
                api_key = os.getenv(env_key)

            if api_key:
                provider.api_key = api_key
                self._env_sourced_providers.add(provider.id)

    def mark_api_key_manual(self, provider_id: str) -> None:
        """把 provider 的 api_key 标记为手工设置（save 时正常落盘，不再按 env 来源剔除）。"""
        self._env_sourced_providers.discard(provider_id)

    def save(self, config: AIConfig) -> None:
        """
        @methoddesc 将配置保存到用户级 YAML 文件

        始终写入 ~/.precis/ai_providers.yaml。
        使用原子写入（临时文件 + os.replace）：此文件含 API Key 等敏感配置，
        裸 open("w") 在写入中途崩溃/断电会产生半截文件，导致用户配置丢失。

        §2.12: env 注入的 api_key 不落盘（否则 env 覆盖被一次性写死进配置文件，
        用户此后换 env 变量不再生效还以为 env 是活的）。
        """
        user_path = self.config_path
        user_path.parent.mkdir(parents=True, exist_ok=True)

        data = config.model_dump(exclude_none=True)
        data = self._encrypt_api_keys(data)

        if self._env_sourced_providers:
            for provider_data in data.get("providers", []):
                if provider_data.get("id") in self._env_sourced_providers:
                    provider_data.pop("api_key", None)

        write_yaml_atomic(user_path, data)

        self.invalidate_cache()

    def invalidate_cache(self) -> None:
        """清除缓存，强制下次 load() 重新读取文件"""
        self._cached_config = None
        self._cached_mtime = None

    def _create_default(self) -> AIConfig:
        """创建空配置模板（不预置任何 Provider）。

        配置文件只反映用户真实配置过的内容——首次运行预置 DeepSeek 等
        占位条目会让新机器显示"当前 Provider: DeepSeek"却无钥匙可用，
        误导为内置/已配置（用户实测踩坑）。厂商发现经 provider add 的
        预设菜单完成（presets.py 单一事实源）；首个 Provider 添加时
        自动激活（providers 路由自动写 defaults.chat）。
        """
        return AIConfig(providers=[], defaults={})


# 全局实例
loader = ConfigLoader()
