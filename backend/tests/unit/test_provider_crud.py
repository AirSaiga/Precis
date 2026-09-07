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
@fileoverview AI Provider CRUD 端点单元测试

测试 providers.py 中新增的创建、更新、删除端点及预设端点。
使用 monkeypatch 替换 loader 的 load/save 避免文件 I/O。
"""

import pytest

from app.api.routers.ai.models import CreateProviderRequest, UpdateProviderRequest
from app.api.routers.ai.providers import (
    create_provider,
    delete_provider,
    list_presets,
    update_provider,
)
from app.shared.services.llm.config.models import AIConfig, AIProvider, ProviderType


@pytest.fixture
def empty_config():
    return AIConfig(providers=[], defaults={"chat": ""})


@pytest.fixture
def config_with_deepseek():
    return AIConfig(
        providers=[
            AIProvider(
                id="deepseek",
                name="DeepSeek",
                type=ProviderType.OPENAI,
                base_url="https://api.deepseek.com/v1",
                api_key="sk-test-key",
                model="deepseek-chat",
            )
        ],
        defaults={"chat": "deepseek"},
    )


@pytest.fixture
def patch_loader(monkeypatch):
    """工厂 fixture：注入 load/save 到 providers 端点"""

    def _patch(stored_config: AIConfig):
        saved_configs = []

        def fake_load():
            return stored_config

        def fake_save(cfg):
            nonlocal stored_config
            stored_config = cfg
            saved_configs.append(cfg)

        monkeypatch.setattr("app.api.routers.ai.providers.loader.load", fake_load)
        monkeypatch.setattr("app.api.routers.ai.providers.loader.save", fake_save)
        return saved_configs

    return _patch


class TestListPresets:
    @pytest.mark.asyncio
    async def test_returns_deepseek_preset(self):
        result = await list_presets()
        assert len(result) >= 1
        ds = next(p for p in result if p["id"] == "deepseek")
        assert ds["name"] == "DeepSeek"
        assert ds["type"] == "openai"
        assert ds["base_url"] == "https://api.deepseek.com"
        assert "deepseek-v4-flash" in ds["models"]

    @pytest.mark.asyncio
    async def test_returns_mimo_preset(self):
        # MIMO 预设（mimo-v2.5 / mimo-v2.5-pro）必须可被前端和 CLI 获取
        result = await list_presets()
        mimo = next(p for p in result if p["id"] == "mimo")
        assert mimo["name"] == "Xiaomi MiMo"
        assert mimo["type"] == "openai"
        assert mimo["base_url"] == "https://api.xiaomimimo.com/v1"
        assert mimo["default_model"] == "mimo-v2.5"
        assert "mimo-v2.5" in mimo["models"]
        assert "mimo-v2.5-pro" in mimo["models"]

    @pytest.mark.asyncio
    async def test_preset_has_required_fields(self):
        result = await list_presets()
        for p in result:
            assert "id" in p
            assert "name" in p
            assert "type" in p
            assert "base_url" in p
            assert "default_model" in p
            assert "models" in p


class TestPresetCatalog:
    """预设目录完整性：国内主流厂商覆盖与预设字段不变量（维护 SOP 见 presets.py 同目录文档）"""

    @pytest.mark.asyncio
    async def test_domestic_mainstream_providers_covered(self):
        # 2026-09 标准：国内主流大模型厂商预设必须可被前端设置页与 CLI 获取
        result = await list_presets()
        ids = {p["id"] for p in result}
        expected = {
            "deepseek",
            "qwen",
            "glm",
            "kimi",
            "minimax",
            "mimo",
        }
        assert expected <= ids

    @pytest.mark.asyncio
    async def test_preset_ids_unique(self):
        result = await list_presets()
        ids = [p["id"] for p in result]
        assert len(ids) == len(set(ids))

    @pytest.mark.asyncio
    async def test_openai_presets_base_url_is_https_without_trailing_slash(self):
        # openai SDK 会在 base_url 后拼接路径：云端端点必须 https，且不得带尾斜杠（避免双斜杠）
        result = await list_presets()
        for p in result:
            if p["type"] == "openai":
                assert p["base_url"].startswith("https://")
                assert not p["base_url"].endswith("/")

    @pytest.mark.asyncio
    async def test_default_model_listed_in_models(self):
        # 前端添加表单的模型下拉以 models 为唯一候选，默认模型必须在其中（Ollama 模型列表动态探测，豁免）
        result = await list_presets()
        for p in result:
            if p["type"] == "openai":
                assert p["default_model"] in p["models"]

    @pytest.mark.asyncio
    async def test_qwen_preset(self):
        result = await list_presets()
        q = next(p for p in result if p["id"] == "qwen")
        assert q["name"] == "通义千问 Qwen"
        assert q["type"] == "openai"
        assert q["base_url"] == "https://dashscope.aliyuncs.com/compatible-mode/v1"
        assert q["default_model"] == "qwen3.8-max"


class TestCreateProvider:
    @pytest.mark.asyncio
    async def test_create_first_provider(self, patch_loader, empty_config):
        saved = patch_loader(empty_config)
        req = CreateProviderRequest(
            name="DeepSeek",
            type="openai",
            base_url="https://api.deepseek.com/v1",
            api_key="sk-abc",
            model="deepseek-chat",
        )
        result = await create_provider(req)
        assert result.id == "deepseek"
        assert result.name == "DeepSeek"
        assert result.model == "deepseek-chat"
        assert result.is_configured is True
        assert len(saved) == 1
        assert len(saved[0].providers) == 1

    @pytest.mark.asyncio
    async def test_create_first_provider_auto_activates(self, patch_loader, empty_config):
        # 无默认 Provider 时，新建后应自动设为默认，避免 "No default provider configured"
        saved = patch_loader(empty_config)
        req = CreateProviderRequest(
            name="Xiaomi MiMo",
            type="openai",
            base_url="https://api.xiaomimimo.com/v1",
            api_key="sk-abc",
            model="mimo-v2.5",
        )
        await create_provider(req)
        assert saved[0].defaults.get("chat") == "xiaomi-mimo"

    @pytest.mark.asyncio
    async def test_create_does_not_override_existing_default(self, patch_loader, config_with_deepseek):
        # 已存在默认 Provider 时，新建不应抢占默认
        saved = patch_loader(config_with_deepseek)
        req = CreateProviderRequest(
            name="Xiaomi MiMo",
            type="openai",
            base_url="https://api.xiaomimimo.com/v1",
            api_key="sk-abc",
            model="mimo-v2.5",
        )
        await create_provider(req)
        assert saved[0].defaults.get("chat") == "deepseek"

    @pytest.mark.asyncio
    async def test_create_with_duplicate_id_gets_suffix(self, patch_loader, config_with_deepseek):
        saved = patch_loader(config_with_deepseek)
        req = CreateProviderRequest(
            name="DeepSeek",
            type="openai",
            base_url="https://api.deepseek.com/v1",
            api_key="sk-xyz",
            model="deepseek-reasoner",
        )
        result = await create_provider(req)
        assert result.id == "deepseek-1"
        assert len(saved[0].providers) == 2

    @pytest.mark.asyncio
    async def test_create_with_invalid_type_raises_400(self, patch_loader, empty_config):
        patch_loader(empty_config)
        req = CreateProviderRequest(
            name="Test",
            type="invalid_type",
            base_url="http://example.com",
            model="test-model",
        )
        with pytest.raises(Exception) as exc_info:
            await create_provider(req)
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_create_local_provider_no_key(self, patch_loader, empty_config):
        saved = patch_loader(empty_config)
        req = CreateProviderRequest(
            name="Ollama Local",
            type="ollama",
            base_url="http://localhost:11434",
            model="llama3.2",
        )
        result = await create_provider(req)
        assert result.id == "ollama-local"
        assert result.is_configured is True
        assert len(saved) == 1


class TestUpdateProvider:
    @pytest.mark.asyncio
    async def test_update_api_key(self, patch_loader, config_with_deepseek):
        saved = patch_loader(config_with_deepseek)
        req = UpdateProviderRequest(api_key="sk-new-key")
        result = await update_provider("deepseek", req)
        assert result.id == "deepseek"
        assert saved[0].providers[0].api_key == "sk-new-key"

    @pytest.mark.asyncio
    async def test_update_model(self, patch_loader, config_with_deepseek):
        saved = patch_loader(config_with_deepseek)
        req = UpdateProviderRequest(model="deepseek-reasoner")
        result = await update_provider("deepseek", req)
        assert result.model == "deepseek-reasoner"
        assert saved[0].providers[0].model == "deepseek-reasoner"

    @pytest.mark.asyncio
    async def test_update_nonexistent_raises_404(self, patch_loader, config_with_deepseek):
        patch_loader(config_with_deepseek)
        req = UpdateProviderRequest(name="New Name")
        with pytest.raises(Exception) as exc_info:
            await update_provider("nonexistent", req)
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_none_fields_unchanged(self, patch_loader, config_with_deepseek):
        saved = patch_loader(config_with_deepseek)
        original_name = config_with_deepseek.providers[0].name
        req = UpdateProviderRequest(model="new-model")
        await update_provider("deepseek", req)
        assert saved[0].providers[0].name == original_name
        assert saved[0].providers[0].model == "new-model"


class TestDeleteProvider:
    @pytest.mark.asyncio
    async def test_delete_existing(self, patch_loader, config_with_deepseek):
        saved = patch_loader(config_with_deepseek)
        result = await delete_provider("deepseek")
        assert result["success"] is True
        assert result["deleted"] == "deepseek"
        assert len(saved[0].providers) == 0

    @pytest.mark.asyncio
    async def test_delete_active_clears_default(self, patch_loader, config_with_deepseek):
        saved = patch_loader(config_with_deepseek)
        assert config_with_deepseek.defaults.get("chat") == "deepseek"
        await delete_provider("deepseek")
        assert len(saved) == 1
        assert saved[0].defaults.get("chat") == ""

    @pytest.mark.asyncio
    async def test_delete_nonexistent_raises_404(self, patch_loader, config_with_deepseek):
        patch_loader(config_with_deepseek)
        with pytest.raises(Exception) as exc_info:
            await delete_provider("nonexistent")
        assert exc_info.value.status_code == 404
