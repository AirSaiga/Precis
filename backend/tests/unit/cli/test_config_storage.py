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
"""cli.shell.config_storage 单元测试。

验证 reload_providers_config 的失败感知契约（D1 修复）：
- 配置文件损坏时 reload_providers_config() 返回 False（此前恒 True，调用方错误分支死代码）；
- 配置文件正常时返回 True；
- _load() 默认（非严格）模式保持静默容错语义不变（损坏配置回退空 AIConfig）。
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

import app.cli.shell.config_storage as config_storage
from app.cli.shell.config_storage import CLIConfigStorage, get_cli_config, reload_providers_config
from app.shared.services.llm.config.loader import loader

VALID_CONFIG = {
    "version": "2.0",
    "providers": [
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai",
            "base_url": "https://api.deepseek.com",
            "api_key": None,
            "model": "deepseek-chat",
        }
    ],
    "defaults": {"chat": "deepseek"},
}


@pytest.fixture
def isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> config_storage.CLIConfigStorage:
    """将全局 loader 指向临时配置文件，并重置单例，避免污染其他测试。"""
    config_file = tmp_path / "ai_providers.yaml"
    config_file.write_text(yaml.dump(VALID_CONFIG), encoding="utf-8")
    monkeypatch.setattr(loader, "config_path", config_file)
    loader.invalidate_cache()
    monkeypatch.setattr(config_storage, "_cli_config", None)
    return get_cli_config()


def test_reload_returns_true_on_valid_config(isolated_storage: CLIConfigStorage) -> None:
    """正常配置文件：reload 成功并返回 True，内存态包含已有 Provider。"""
    assert reload_providers_config() is True
    assert [p.id for p in isolated_storage.list_providers()] == ["deepseek"]


def test_reload_returns_false_on_corrupt_config(isolated_storage: CLIConfigStorage) -> None:
    """损坏的配置文件：reload 感知失败并返回 False（调用方错误分支可达）。"""
    config_path = Path(loader.config_path)
    config_path.write_text("providers: [unclosed\n  ::bad yaml", encoding="utf-8")

    assert reload_providers_config() is False


def test_reload_returns_false_on_unsupported_version(isolated_storage: CLIConfigStorage) -> None:
    """版本号非法（非 2.x）：load 抛 ValueError，reload 返回 False。"""
    config_path = Path(loader.config_path)
    config_path.write_text(yaml.dump({"version": "1.0", "providers": []}), encoding="utf-8")

    assert reload_providers_config() is False


def test_init_fails_fast_on_corrupt_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """§4.2: 启动（__init__）即 strict——损坏配置抛带修复指引的 RuntimeError，
    不再静默回退空配置（防止后续 add/save 把空配置覆盖写盘销毁原配置）。"""
    # 隔离：指向临时配置文件（写坏它不能污染其他测试的共享 loader 状态）
    config_file = tmp_path / "ai_providers.yaml"
    config_file.write_text("::: not yaml at all", encoding="utf-8")
    monkeypatch.setattr(loader, "config_path", config_file)
    loader.invalidate_cache()
    monkeypatch.setattr(config_storage, "_cli_config", None)

    with pytest.raises(RuntimeError, match="配置文件损坏"):
        CLIConfigStorage()


def test_load_non_strict_still_tolerates_corrupt_config(isolated_storage: CLIConfigStorage) -> None:
    """非严格 _load（运行时 reload 容错）语义不变：损坏配置静默回退空 AIConfig。"""
    config_path = Path(loader.config_path)
    config_path.write_text("::: not yaml at all", encoding="utf-8")
    loader.invalidate_cache()

    isolated_storage._load(strict=False)
    assert isolated_storage.list_providers() == []
