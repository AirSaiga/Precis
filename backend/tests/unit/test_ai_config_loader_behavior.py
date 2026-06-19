"""
@fileoverview AI Provider 配置加载器行为测试

覆盖 load/save/cache/version 校验。
"""

from __future__ import annotations

import pytest
import yaml

from app.shared.services.llm.config.loader import ConfigLoader
from app.shared.services.llm.config.models import AIConfig


class TestConfigLoader:
    """ConfigLoader 行为"""

    def test_load_creates_default_when_missing(self, tmp_path):
        config_file = tmp_path / "ai_providers.yaml"
        loader = ConfigLoader(config_path=config_file)
        config = loader.load()
        assert config is not None
        assert len(config.providers) >= 1
        assert config_file.exists()

    def test_cache_hit_returns_same_object(self, tmp_path):
        config_file = tmp_path / "ai_providers.yaml"
        config_file.write_text(
            yaml.dump({"version": "2.0", "providers": [], "defaults": {"chat": "test"}}),
            encoding="utf-8",
        )
        loader = ConfigLoader(config_path=config_file)
        config1 = loader.load()
        config2 = loader.load()
        assert config1 is config2

    def test_save_writes_and_invalidates_cache(self, tmp_path):
        config_file = tmp_path / "ai_providers.yaml"
        loader = ConfigLoader(config_path=config_file)
        loader.load()  # 创建默认配置

        new_config = AIConfig(providers=[], defaults={"chat": "custom"})
        loader.save(new_config)

        with open(config_file, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["defaults"]["chat"] == "custom"

        reloaded = loader.load()
        assert reloaded.defaults["chat"] == "custom"

    def test_unsupported_version_raises(self, tmp_path):
        config_file = tmp_path / "ai_providers.yaml"
        config_file.write_text(yaml.dump({"version": "1.0", "providers": []}), encoding="utf-8")
        loader = ConfigLoader(config_path=config_file)
        with pytest.raises(ValueError):
            loader.load()
