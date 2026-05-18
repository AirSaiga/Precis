"""
@fileoverview AI 配置加载器

功能概述:
- 从 ~/.precis/ai_providers.json 加载 AI Provider 配置
- 支持环境变量 ${VAR} 递归替换
- 配置版本检查（仅兼容 2.x）
- 首次使用自动创建默认空配置

架构设计:
- 单例模式：全局 loader 实例供各模块共享
- 与 Pydantic 模型联动：加载后自动校验为 AIConfig 对象
- 原子性保存：直接写入 JSON 文件

输入示例:
    # ~/.precis/ai_providers.json
    {
      "version": "2.0",
      "providers": [{"id": "openai", "base_url": "...", "api_key": "${OPENAI_API_KEY}", "model": "gpt-4"}]
    }

输出示例:
    config = loader.load()
    # AIConfig 实例，api_key 已替换为实际环境变量值
"""

import json
import os
import re
from pathlib import Path

from .models import AIConfig


class ConfigLoader:
    """
    @classdesc 配置加载器 - 只支持 v2.0

    从 ~/.precis/ai_providers.json 加载 AI Provider 配置，
    支持环境变量 ${VAR} 递归替换，配置版本检查（仅兼容 2.x），
    首次使用自动创建默认空配置。

    设计原则：
    - 单例模式：全局 loader 实例供各模块共享
    - 与 Pydantic 模型联动：加载后自动校验为 AIConfig 对象
    - 原子性保存：直接写入 JSON 文件
    """

    CONFIG_PATH = Path.home() / ".precis" / "ai_providers.json"

    def _expand_env(self, value: any) -> any:
        """
        @methoddesc 递归替换字符串中的环境变量 ${VAR}

        支持字符串、字典、列表的递归处理。
        如果环境变量不存在，替换为空字符串。

        参数:
            value: 任意类型的值（字符串/字典/列表/其他）

        返回:
            替换后的值，类型与输入保持一致
        """
        if isinstance(value, str):
            # 使用正则匹配 ${VAR_NAME} 格式，并从 os.environ 中获取对应值
            pattern = r"\$\{([^}]+)\}"
            return re.sub(pattern, lambda m: os.getenv(m.group(1), ""), value)
        elif isinstance(value, dict):
            # 递归处理字典的每个值
            return {k: self._expand_env(v) for k, v in value.items()}
        elif isinstance(value, list):
            # 递归处理列表的每个元素
            return [self._expand_env(v) for v in value]
        return value

    def load(self) -> AIConfig:
        """
        @methoddesc 加载 AI Provider 配置文件

        如果配置文件不存在，自动创建默认空配置。
        加载后会进行版本校验（仅支持 2.x）并递归替换环境变量。

        返回:
            AIConfig 配置对象

        异常:
            ValueError: 配置文件版本不兼容时抛出
        """
        if not self.CONFIG_PATH.exists():
            # 首次使用，创建默认配置（空）
            return self._create_default()

        with open(self.CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f) or {}

        # 版本检查（兼容 2.x 系列）
        version = data.get("version", "unknown")
        if not isinstance(version, str) or not version.startswith("2."):
            raise ValueError(f"Unsupported config version: {version}, expected 2.x")

        # 环境变量替换
        data = self._expand_env(data)

        return AIConfig(**data)

    def save(self, config: AIConfig):
        """
        @methoddesc 将配置保存到 JSON 文件

        会自动创建配置文件的父目录。

        参数:
            config: AIConfig 配置对象
        """
        self.CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

        with open(self.CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config.model_dump(exclude_none=True), f, indent=2, ensure_ascii=False)

    def _create_default(self) -> AIConfig:
        """
        @methoddesc 创建默认的空配置

        返回:
            空的 AIConfig 实例（无 Provider，默认聊天为空字符串）
        """
        return AIConfig(providers=[], defaults={"chat": ""})


# 全局实例
loader = ConfigLoader()
