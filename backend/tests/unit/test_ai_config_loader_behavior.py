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

    def test_save_is_atomic_original_preserved_on_write_failure(self, tmp_path):
        """B10 回归：写入中途失败时原配置文件必须完好（原子写，不再裸 open("w") 截断）。"""
        from unittest.mock import patch

        config_file = tmp_path / "ai_providers.yaml"
        loader = ConfigLoader(config_path=config_file)
        loader.load()  # 生成默认配置
        original = config_file.read_text(encoding="utf-8")

        new_config = AIConfig(providers=[], defaults={"chat": "changed"})
        with patch("app.shared.core.io.yaml.yaml.safe_dump", side_effect=RuntimeError("disk full")):
            with pytest.raises(RuntimeError, match="disk full"):
                loader.save(new_config)

        # 原文件内容未被破坏（裸 open("w") 会在打开瞬间清空文件）
        assert config_file.read_text(encoding="utf-8") == original
        # 无 .tmp 残留
        assert [p.name for p in tmp_path.iterdir() if p.suffix == ".tmp"] == []

    def test_save_leaves_no_temp_files(self, tmp_path):
        """成功保存后目录中不残留临时文件。"""
        config_file = tmp_path / "ai_providers.yaml"
        loader = ConfigLoader(config_path=config_file)
        loader.load()

        loader.save(AIConfig(providers=[], defaults={"chat": "custom"}))

        assert [p.name for p in tmp_path.iterdir() if p.suffix == ".tmp"] == []
        assert config_file.exists()
