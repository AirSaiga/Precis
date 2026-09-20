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
@fileoverview CLI AI 配置存储模块

功能概述:
- 适配 LLM 配置系统，管理 ~/.precis/ai_providers.yaml
- 提供 Provider 的增删改查与默认设置切换
- 支持配置热重载

架构设计:
- CLIConfigStorage 封装 AIConfig 的加载与持久化
- 直接使用 AIProvider 模型，与 API 层保持一致
- 单例模式通过 get_cli_config() 提供全局访问
"""

from __future__ import annotations

from app.shared.services.llm.config.loader import loader
from app.shared.services.llm.config.models import AIConfig, AIProvider


class CLIConfigStorage:
    """CLI 配置存储管理类（直接使用 AIProvider 模型）"""

    def __init__(self) -> None:
        self._config: AIConfig
        self._loaded_mtime: float | None = None
        # §4.2: 启动即 strict——providers YAML 损坏时 fail-fast（明确报错+退出），
        # 不再静默回退空配置（此前 add/save 会把空配置覆盖写盘，原配置彻底销毁）
        self._load(strict=True)

    def _load(self, strict: bool = False) -> None:
        """从文件加载配置。

        Args:
            strict: 严格模式。为 True 时解析失败抛携带修复指引的 RuntimeError；
                为 False（默认）时静默回退到空 AIConfig（运行时 reload 容错语义）。
        """
        try:
            self._config = loader.load()
            try:
                self._loaded_mtime = loader.config_path.stat().st_mtime
            except OSError:
                self._loaded_mtime = None
        except Exception as e:
            if strict:
                # §4.2: 携带文件路径与修复指引的明确错误（调用方以非 0 退出呈现）
                config_path = getattr(loader, "config_path", None)
                raise RuntimeError(
                    f"AI Provider 配置文件损坏，已阻止启动以防空配置覆盖写盘：\n"
                    f"  文件: {config_path}\n"
                    f"  错误: {e}\n"
                    f"  修复: 手工修正 YAML 语法后重试；或备份后删除该文件重新 setup"
                ) from e
            self._config = AIConfig()

    def _save(self) -> None:
        """保存配置到文件。

        §4.10: 写前 mtime 校验（读-改-写丢更新防护）——本实例加载后文件被其他进程
        （TUI/Electron/另一 CLI 会话）修改过则拒绝写入并提示，避免后写覆盖先写。
        """
        try:
            current_mtime = loader.config_path.stat().st_mtime
            if self._loaded_mtime is not None and current_mtime != self._loaded_mtime:
                raise RuntimeError(
                    "配置已被其他进程修改（CLI/TUI/Electron 并发编辑），请重新进入本会话加载最新配置后再修改"
                )
        except OSError:
            pass  # 文件尚不存在（首次写入）等场景直接尝试保存
        loader.save(self._config)
        try:
            self._loaded_mtime = loader.config_path.stat().st_mtime
        except OSError:
            self._loaded_mtime = None

    def get_provider(self, provider_id: str) -> AIProvider | None:
        """获取指定 Provider"""
        for p in self._config.providers:
            if p.id == provider_id:
                return p
        return None

    def get_active_provider(self) -> AIProvider | None:
        """获取当前活动的 Provider"""
        # 从 defaults 中获取默认 chat provider
        default_id = self._config.defaults.get("chat")
        if default_id:
            return self.get_provider(default_id)
        # 如果没有设置，返回第一个
        if self._config.providers:
            return self._config.providers[0]
        return None

    def set_active_provider(self, provider_id: str) -> bool:
        """设置活动 Provider"""
        if not any(p.id == provider_id for p in self._config.providers):
            return False
        self._config.defaults["chat"] = provider_id
        self._save()
        return True

    def add_or_update_provider(self, provider: AIProvider) -> None:
        """添加或更新 Provider"""
        # 查找并替换或添加
        for i, p in enumerate(self._config.providers):
            if p.id == provider.id:
                self._config.providers[i] = provider
                break
        else:
            self._config.providers.append(provider)

        # 如果是第一个 provider，设为默认
        if len(self._config.providers) == 1:
            self._config.defaults["chat"] = provider.id

        self._save()

    def mark_api_key_manual(self, provider_id: str) -> None:
        """把 provider 的 api_key 标记为手工设置（§2.12：save 时不再按 env 来源剔除落盘）。

        CLI 的 add/edit 路径在用户显式输入 API Key 后、落盘前调用——否则该 provider
        若存在同名环境变量（<ID>_API_KEY），save() 会把用户刚输入的 key 当 env 来源
        剔除，新 key 永不落盘（env 移除后 provider 无 key 可用）。
        """
        loader.mark_api_key_manual(provider_id)

    def list_providers(self) -> list[AIProvider]:
        """列出所有 Providers"""
        return list(self._config.providers)

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
    """重新加载 Provider 配置。

    Returns:
        重载成功返回 True；配置文件损坏/格式非法导致解析失败时返回 False，
        调用方据此提示用户检查文件格式（如 provider reload 命令的错误分支）。
    """
    global _cli_config
    if _cli_config:
        loader.invalidate_cache()
        try:
            _cli_config._load(strict=True)
        except Exception:
            return False
    return True
