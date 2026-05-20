"""
@fileoverview AI 配置加载器

功能概述:
- 从 ~/.precis/ai_providers.yaml 加载 AI Provider 配置
- 支持环境变量 ${VAR} 递归替换
- 配置版本检查（仅兼容 2.x）
- 首次使用自动创建默认空配置
- 支持项目级 / 用户级 / 系统级三级配置查找
- mtime 缓存避免重复文件读取

架构设计:
- 路径查找委托 ConfigPaths（路径单一真相源）
- 加载逻辑在 ConfigLoader（加载单一职责）
- 单例模式：全局 loader 实例供各模块共享
- YAML 格式存储：支持注释，更利于手动编辑

输入示例:
    # ~/.precis/ai_providers.yaml
    version: "2.0"
    providers:
      - id: openai
        base_url: "..."
        api_key: "${OPENAI_API_KEY}"
        model: gpt-4

输出示例:
    config = loader.load()
    # AIConfig 实例，api_key 已替换为实际环境变量值
"""

import os
import re
from pathlib import Path
from typing import Optional

import yaml

from app.shared.core.config import ConfigPaths

from .models import AIConfig


class ConfigLoader:
    """
    @classdesc 配置加载器 - 只支持 v2.0

    路径查找委托 ConfigPaths，三级优先级：
    1. 项目级：{cwd}/.precis/ai_providers.yaml
    2. 用户级：~/.precis/ai_providers.yaml
    3. 系统级：/etc/precis/ai_providers.yaml（Unix only）

    设计原则：
    - AI 配置是全局设置，不依赖是否打开项目
    - ConfigPaths 管路径，ConfigLoader 管加载
    - save() 始终写入用户级路径
    - mtime 缓存避免每次请求都读文件
    """

    CONFIG_FILENAME = "ai_providers.yaml"

    # mtime 缓存
    _cached_config: Optional[AIConfig] = None
    _cached_path: Optional[Path] = None
    _cached_mtime: Optional[float] = None

    @property
    def USER_PATH(self) -> Path:  # noqa: N802
        """用户级配置路径（save 的写入目标）"""
        return ConfigPaths.ai_providers_user()

    def _resolve_path(self) -> Path:
        """
        @methoddesc 按优先级查找配置文件

        委托 ConfigPaths.ai_providers() 实现三级查找。
        项目级检测基于 cwd()：后端从 backend/ 启动时，
        向上 1 层就是项目根，自然能找到 .precis/ 目录。

        返回:
            配置文件的 Path（可能不存在，由调用方判断）
        """
        # 检测 cwd 下的项目级配置
        project_root = None
        cwd_config = Path.cwd() / ConfigPaths.PROJECT_CONFIG_DIR / self.CONFIG_FILENAME
        if cwd_config.exists():
            project_root = str(Path.cwd())

        return ConfigPaths.ai_providers(project_root)

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
            return re.sub(r"\$\{([^}]+)\}", lambda m: os.getenv(m.group(1), ""), value)
        elif isinstance(value, dict):
            return {k: self._expand_env(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [self._expand_env(v) for v in value]
        return value

    def load(self) -> AIConfig:
        """
        @methoddesc 加载 AI Provider 配置文件

        按项目级 > 用户级 > 系统级优先级查找。
        找不到任何配置文件时返回默认空配置。
        带 mtime 缓存：文件未变更时直接返回缓存。

        返回:
            AIConfig 配置对象

        异常:
            ValueError: 配置文件版本不兼容时抛出
        """
        config_path = self._resolve_path()

        # 缓存命中：路径一致且文件未变更
        if self._cached_config is not None and self._cached_path == config_path and config_path.exists():
            try:
                current_mtime = config_path.stat().st_mtime
                if current_mtime == self._cached_mtime:
                    return self._cached_config
            except OSError:
                pass

        if not config_path.exists():
            return self._create_default()

        with open(config_path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        # 版本检查（兼容 2.x 系列）
        version = data.get("version", "unknown")
        if not isinstance(version, str) or not version.startswith("2."):
            raise ValueError(f"Unsupported config version: {version}, expected 2.x")

        # 环境变量替换
        data = self._expand_env(data)

        config = AIConfig(**data)

        # 更新缓存
        try:
            self._cached_path = config_path
            self._cached_mtime = config_path.stat().st_mtime
            self._cached_config = config
        except OSError:
            pass

        return config

    def save(self, config: AIConfig):
        """
        @methoddesc 将配置保存到用户级 YAML 文件

        始终写入 ~/.precis/ai_providers.yaml，
        自动创建父目录。写入后自动失效缓存。

        参数:
            config: AIConfig 配置对象
        """
        user_path = self.USER_PATH
        user_path.parent.mkdir(parents=True, exist_ok=True)

        data = config.model_dump(exclude_none=True)
        with open(user_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

        self.invalidate_cache()

    def invalidate_cache(self):
        """清除缓存，强制下次 load() 重新读取文件"""
        self._cached_config = None
        self._cached_path = None
        self._cached_mtime = None

    def _create_default(self) -> AIConfig:
        """
        @methoddesc 创建默认的空配置

        返回:
            空的 AIConfig 实例（无 Provider，默认聊天为空字符串）
        """
        return AIConfig(providers=[], defaults={"chat": ""})

    @property
    def config_path(self) -> Path:
        """当前解析到的配置文件路径"""
        return self._resolve_path()


# 全局实例
loader = ConfigLoader()
