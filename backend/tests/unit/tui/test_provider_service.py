"""TUI ProviderService 单元测试。

mock 边界：
- ``CLIConfigStorage``：通过构造时注入 fake storage（不依赖真实文件 IO）。
- ``registry.create``：monkeypatch 为返回带 health 协程的假 Provider。

覆盖：list/get_active/add（含 ID 去重）/update（含 context_window 归一）/
delete/set_active/test_connection（ok/error/异常）。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.cli.tui.services.provider_service import ProviderService
from app.shared.services.llm.config.models import AIProvider, ProviderType


class FakeStorage:
    """内存版 CLIConfigStorage 替身，仅实现 ProviderService 用到的方法。"""

    def __init__(self, providers: list[AIProvider] | None = None, default_id: str = ""):
        self._providers = list(providers or [])
        self._default = default_id

    def list_providers(self) -> list[AIProvider]:
        return list(self._providers)

    def get_provider(self, provider_id: str) -> AIProvider | None:
        for p in self._providers:
            if p.id == provider_id:
                return p
        return None

    def get_active_provider(self) -> AIProvider | None:
        if self._default:
            for p in self._providers:
                if p.id == self._default:
                    return p
        return self._providers[0] if self._providers else None

    def set_active_provider(self, provider_id: str) -> bool:
        if not any(p.id == provider_id for p in self._providers):
            return False
        self._default = provider_id
        return True

    def add_or_update_provider(self, provider: AIProvider) -> None:
        for i, p in enumerate(self._providers):
            if p.id == provider.id:
                self._providers[i] = provider
                break
        else:
            self._providers.append(provider)
        if not self._default and self._providers:
            self._default = self._providers[0].id

    def delete_provider(self, provider_id: str) -> bool:
        before = len(self._providers)
        self._providers = [p for p in self._providers if p.id != provider_id]
        if len(self._providers) < before:
            if self._default == provider_id:
                self._default = ""
            return True
        return False


def _make_provider(
    pid: str = "openai",
    name: str = "OpenAI",
    model: str = "gpt-4o",
    api_key: str | None = "sk-test",
    context_window: int | None = None,
    ptype: ProviderType = ProviderType.OPENAI,
) -> AIProvider:
    return AIProvider(
        id=pid,
        name=name,
        type=ptype,
        base_url="https://api.openai.com/v1",
        api_key=api_key,
        model=model,
        context_window=context_window,
    )


# ── 查询 ────────────────────────────────────────────────────────────


def test_list_providers_returns_all():
    storage = FakeStorage([_make_provider("a"), _make_provider("b")])
    svc = ProviderService(storage)
    assert len(svc.list_providers()) == 2


def test_get_active_returns_default():
    storage = FakeStorage([_make_provider("a"), _make_provider("b")], default_id="b")
    assert svc_get_active_id(storage) == "b"


def test_get_active_none_when_empty():
    svc = ProviderService(FakeStorage([]))
    assert svc.get_active() is None


def test_get_provider_found_and_missing():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    assert svc.get_provider("openai") is not None
    assert svc.get_provider("nope") is None


def svc_get_active_id(storage: FakeStorage) -> str | None:
    active = ProviderService(storage).get_active()
    return active.id if active else None


# ── add（含 ID 去重）────────────────────────────────────────────────


def test_add_uses_preset_defaults():
    svc = ProviderService(FakeStorage())
    provider = svc.add("deepseek")
    assert provider.id == "deepseek"
    assert provider.name == "DeepSeek"
    assert provider.model == "deepseek-v4-pro"
    assert provider.type == ProviderType.OPENAI
    # 持久化到 storage
    assert svc.get_provider("deepseek") is not None


def test_add_overrides_model_and_name():
    svc = ProviderService(FakeStorage())
    provider = svc.add("deepseek", model="custom-model", name="My DeepSeek")
    assert provider.model == "custom-model"
    assert provider.name == "My DeepSeek"


def test_add_ollama_no_api_key():
    svc = ProviderService(FakeStorage())
    provider = svc.add("ollama")
    assert provider.type == ProviderType.OLLAMA
    assert provider.api_key is None


def test_add_dedupes_id_when_exists():
    existing = [_make_provider("deepseek")]
    svc = ProviderService(FakeStorage(existing))
    provider = svc.add("deepseek")
    # 原 deepseek 仍在，新的是 deepseek-2
    assert provider.id == "deepseek-2"
    assert {p.id for p in svc.list_providers()} == {"deepseek", "deepseek-2"}


def test_add_dedupes_multiple_suffixes():
    existing = [_make_provider("deepseek"), _make_provider("deepseek-2")]
    svc = ProviderService(FakeStorage(existing))
    provider = svc.add("deepseek")
    assert provider.id == "deepseek-3"


def test_add_unknown_preset_raises():
    svc = ProviderService(FakeStorage())
    with pytest.raises(ValueError, match="未知预设"):
        svc.add("not-a-preset")


def test_add_invalid_context_window_normalized_to_none():
    svc = ProviderService(FakeStorage())
    provider = svc.add("deepseek", context_window=100)  # < 1024
    assert provider.context_window is None


def test_add_valid_context_window_kept():
    svc = ProviderService(FakeStorage())
    provider = svc.add("deepseek", context_window=8192)
    assert provider.context_window == 8192


# ── update ──────────────────────────────────────────────────────────


def test_update_fields():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    updated = svc.update("openai", name="New Name", model="new-model", api_key="sk-new")
    assert updated.name == "New Name"
    assert updated.model == "new-model"
    assert updated.api_key == "sk-new"


def test_update_context_window_normalized():
    svc = ProviderService(FakeStorage([_make_provider("openai", context_window=4096)]))
    updated = svc.update("openai", context_window=50)  # < 1024
    assert updated.context_window is None


def test_update_clears_api_key_with_none():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    updated = svc.update("openai", api_key=None)
    assert updated.api_key is None


def test_update_ignores_empty_strings_for_name_model():
    svc = ProviderService(FakeStorage([_make_provider("openai", name="OpenAI", model="gpt-4o")]))
    updated = svc.update("openai", name="", model="")
    # 空字符串不覆盖
    assert updated.name == "OpenAI"
    assert updated.model == "gpt-4o"


def test_update_missing_provider_raises():
    svc = ProviderService(FakeStorage())
    with pytest.raises(KeyError, match="不存在"):
        svc.update("nope", name="x")


# ── delete / set_active ─────────────────────────────────────────────


def test_delete_removes_provider():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    assert svc.delete("openai") is True
    assert svc.get_provider("openai") is None


def test_delete_missing_returns_false():
    svc = ProviderService(FakeStorage())
    assert svc.delete("nope") is False


def test_set_active():
    svc = ProviderService(FakeStorage([_make_provider("a"), _make_provider("b")]))
    assert svc.set_active("b") is True
    assert svc.get_active().id == "b"


def test_set_active_missing_returns_false():
    svc = ProviderService(FakeStorage([_make_provider("a")]))
    assert svc.set_active("nope") is False


# ── test_connection（mock registry.create）──────────────────────────


class _FakeProv:
    def __init__(self, health_result: dict, raise_exc: Exception | None = None):
        self._health_result = health_result
        self._raise = raise_exc

    async def health(self) -> dict:
        if self._raise is not None:
            raise self._raise
        return self._health_result


@pytest.mark.asyncio
async def test_test_connection_ok():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    with patch(
        "app.cli.tui.services.provider_service.create",
        return_value=_FakeProv({"status": "ok", "latency_ms": 120}),
    ):
        result = await svc.test_connection("openai")
    assert result["status"] == "ok"
    assert result["latency_ms"] == 120
    assert result["error"] is None


@pytest.mark.asyncio
async def test_test_connection_ok_with_response_time_ms_fallback():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    with patch(
        "app.cli.tui.services.provider_service.create",
        return_value=_FakeProv({"status": "ok", "response_time_ms": 200}),
    ):
        result = await svc.test_connection("openai")
    assert result["status"] == "ok"
    assert result["latency_ms"] == 200


@pytest.mark.asyncio
async def test_test_connection_error_status():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    with patch(
        "app.cli.tui.services.provider_service.create",
        return_value=_FakeProv({"status": "error", "error": "连接超时"}),
    ):
        result = await svc.test_connection("openai")
    assert result["status"] == "error"
    assert result["latency_ms"] is None
    assert result["error"] == "连接超时"


@pytest.mark.asyncio
async def test_test_connection_exception_normalized():
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    with patch(
        "app.cli.tui.services.provider_service.create",
        return_value=_FakeProv({}, raise_exc=RuntimeError("boom")),
    ):
        result = await svc.test_connection("openai")
    assert result["status"] == "error"
    assert result["error"] == "boom"


@pytest.mark.asyncio
async def test_test_connection_missing_provider():
    svc = ProviderService(FakeStorage())
    result = await svc.test_connection("nope")
    assert result["status"] == "error"
    assert "不存在" in result["error"]


def test_list_presets_nonempty():
    svc = ProviderService(FakeStorage())
    presets = svc.list_presets()
    assert len(presets) > 0
    ids = {p["id"] for p in presets}
    assert "deepseek" in ids


def test_run_test_sync_wraps_async():
    """run_test_sync 用 asyncio.run 执行 test_connection。"""
    svc = ProviderService(FakeStorage([_make_provider("openai")]))
    with patch(
        "app.cli.tui.services.provider_service.create",
        return_value=_FakeProv({"status": "ok", "latency_ms": 5}),
    ):
        result = svc.run_test_sync("openai")
    assert result["status"] == "ok"
