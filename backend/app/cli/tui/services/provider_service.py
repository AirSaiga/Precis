"""TUI Provider 管理 service。

本模块是 TUI 层对 Provider CRUD + 连接测试的薄包装，业务逻辑（ID 去重、health
结果归一化）在 service 内实现，不 import CLI 的 provider 命令。配置存储直接复用
``app.cli.shell.config_storage``（零 UI 纯 CRUD），连接测试复用 Provider registry
的 ``create`` + ``BaseProvider.health``。

接口契约见 docs/TUI_PARALLEL_TASK_PACKAGES.md 的 P2 节。
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.cli.shell.config_storage import CLIConfigStorage, get_cli_config
from app.shared.services.llm.config.models import AIProvider, ProviderType
from app.shared.services.llm.config.presets import get_preset, get_preset_list
from app.shared.services.llm.providers.registry import create

# context_window 合法下限（与 CLI provider.py 一致，避免无效配置）
MIN_CONTEXT_WINDOW = 1024


class ProviderService:
    """Provider 管理 service：CRUD + 连接测试。

    所有读写最终落到 ``CLIConfigStorage``（持久化到 ~/.precis/ai_providers.yaml）。
    service 自身无状态，可安全被 Screen 持有。构造时注入 storage 便于测试 mock。
    """

    def __init__(self, config: CLIConfigStorage | None = None) -> None:
        # 默认取全局单例；测试可传入 fake storage
        self._config = config if config is not None else get_cli_config()

    # ── 查询 ───────────────────────────────────────────────────────

    def list_providers(self) -> list[AIProvider]:
        """返回全部已配置 Provider。"""
        return self._config.list_providers()

    def get_active(self) -> AIProvider | None:
        """返回当前默认（活动）Provider，无则 None。"""
        return self._config.get_active_provider()

    def get_provider(self, provider_id: str) -> AIProvider | None:
        """按 ID 取单个 Provider。"""
        return self._config.get_provider(provider_id)

    def list_presets(self) -> list[dict[str, Any]]:
        """返回可用预设列表（供添加表单的 Select 渲染）。"""
        return get_preset_list()

    # ── 增删改 ─────────────────────────────────────────────────────

    def add(
        self,
        preset_id: str,
        model: str | None = None,
        name: str | None = None,
        api_key: str | None = None,
        context_window: int | None = None,
    ) -> AIProvider:
        """从预设添加 Provider。

        - model/name 留空时回退到预设默认值。
        - ID 取预设 id，与已有 Provider 冲突时追加 ``-{n}`` 后缀去重（参考 CLI
          provider.py:243-249 的去重规则）。
        - context_window 为 None 表示自动探测；非 None 且 < MIN_CONTEXT_WINDOW 视为非法，
          归一为 None（与 CLI 行为一致）。

        Args:
            preset_id: 预设 ID（如 "deepseek"）。
            model: 模型名，None 用预设默认。
            name: 显示名，None 用预设默认。
            api_key: API Key，本地 Ollama 可为 None。
            context_window: 上下文窗口 tokens，None 自动探测。

        Returns:
            新建的 AIProvider（已持久化）。

        Raises:
            ValueError: 预设不存在。
        """
        preset = get_preset(preset_id)
        if preset is None:
            raise ValueError(f"未知预设: {preset_id}")

        final_model = model or preset["default_model"]
        final_name = name or preset["name"]

        # context_window 非法值归一为 None（自动探测）
        final_cw = context_window
        if final_cw is not None and final_cw < MIN_CONTEXT_WINDOW:
            final_cw = None

        # 生成去重 ID
        provider_id = self._dedupe_id(preset["id"])

        provider = AIProvider(
            id=provider_id,
            name=final_name,
            type=ProviderType.OPENAI if preset["type"] == "openai" else ProviderType.OLLAMA,
            base_url=preset["base_url"],
            model=final_model,
            api_key=api_key or None,
            context_window=final_cw,
        )
        self._config.add_or_update_provider(provider)
        return provider

    def update(self, provider_id: str, **fields: Any) -> AIProvider:
        """更新已有 Provider 的字段。

        支持字段：name / model / api_key / context_window。其余字段忽略。
        context_window 非法值（非 None 且 < MIN_CONTEXT_WINDOW）归一为 None。

        Args:
            provider_id: 目标 Provider ID。
            **fields: 待更新字段。

        Returns:
            更新后的 AIProvider（已持久化）。

        Raises:
            KeyError: Provider 不存在。
        """
        provider = self._config.get_provider(provider_id)
        if provider is None:
            raise KeyError(f"Provider 不存在: {provider_id}")

        if "name" in fields and fields["name"]:
            provider.name = fields["name"]
        if "model" in fields and fields["model"]:
            provider.model = fields["model"]
        if "api_key" in fields:
            # 允许显式置空（传 None 清空 Key）
            provider.api_key = fields["api_key"] or None
        if "context_window" in fields:
            cw = fields["context_window"]
            if cw is not None and cw < MIN_CONTEXT_WINDOW:
                cw = None
            provider.context_window = cw

        self._config.add_or_update_provider(provider)
        return provider

    def delete(self, provider_id: str) -> bool:
        """删除 Provider。返回是否删除成功。"""
        return self._config.delete_provider(provider_id)

    def set_active(self, provider_id: str) -> bool:
        """设置默认 Provider。返回是否成功。"""
        return self._config.set_active_provider(provider_id)

    # ── 连接测试 ───────────────────────────────────────────────────

    async def test_connection(self, provider_id: str) -> dict[str, Any]:
        """异步测试 Provider 连接。

        内部用 ``create(provider)`` 构造 Provider 实例并 ``await prov.health()``。
        health 返回 ``{status, latency_ms, error}``（部分实现用 response_time_ms），
        本方法将 latency 统一为 ``latency_ms``，异常归一为 error 状态。

        Args:
            provider_id: 目标 Provider ID。

        Returns:
            ``{"status": "ok"|"error", "latency_ms": int|None, "error": str|None}``。
            Provider 不存在时返回 error 状态。
        """
        provider = self._config.get_provider(provider_id)
        if provider is None:
            return {"status": "error", "latency_ms": None, "error": f"Provider 不存在: {provider_id}"}

        return await self._run_health(provider)

    async def _run_health(self, provider: AIProvider) -> dict[str, Any]:
        """执行 health 并归一结果。单独抽出便于测试 mock ``create``。

        ``create`` 本身是同步工厂（可能触发网络配置加载），放在调用线程执行；
        ``health`` 是协程，直接 await。整体异常捕获后归一为 error。
        """
        try:
            prov = create(provider)
            result = await prov.health()
        except Exception as e:  # noqa: BLE001 - health 边界异常需归一，不向 TUI 泄漏
            return {"status": "error", "latency_ms": None, "error": str(e)}

        status = result.get("status", "error")
        if status == "ok":
            latency = result.get("latency_ms", result.get("response_time_ms"))
            return {"status": "ok", "latency_ms": latency, "error": None}
        error = result.get("error", "未知错误")
        return {"status": "error", "latency_ms": None, "error": error}

    # ── 内部工具 ───────────────────────────────────────────────────

    def _dedupe_id(self, base_id: str) -> str:
        """若 base_id 已存在，追加 ``-{n}`` 后缀直到唯一。"""
        existing = {p.id for p in self._config.list_providers()}
        if base_id not in existing:
            return base_id
        suffix = 2
        while f"{base_id}-{suffix}" in existing:
            suffix += 1
        return f"{base_id}-{suffix}"

    def run_test_sync(self, provider_id: str) -> dict[str, Any]:
        """同步包装：用 asyncio.run 执行 test_connection。

        供不方便 await 的调用方（如非异步按钮回调在独立线程中）使用。注意：在已有
        运行的事件循环中调用会失败，应优先使用 ``await test_connection(...)``。
        """
        return asyncio.run(self.test_connection(provider_id))


__all__ = ["ProviderService", "MIN_CONTEXT_WINDOW"]
