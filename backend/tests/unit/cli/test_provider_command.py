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
"""cli.shell.commands.provider 编辑流程单元测试。

验证两项修复：
- 项 2（D2）：编辑 Provider 时 ESC/中断丢弃编辑副本，仅显式 "done" 才落盘
  （此前 ESC 与 done 同路 break，循环外无条件保存，半成品/取消的编辑被持久化）；
- 项 4（附表6）：编辑 context_window 时非法输入保留原值（此前非法输入被无条件赋值为 None），
  留空（直接回车）仍为 None（自动探测语义不变）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

import app.cli.shell.config_storage as config_storage
from app.cli.shell.commands.provider import ProviderCommand
from app.cli.shell.interactive_menu import InteractiveMenu
from app.shared.services.llm.config.loader import loader

PROVIDER_YAML = {
    "version": "2.0",
    "providers": [
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai",
            "base_url": "https://api.deepseek.com",
            "api_key": None,
            "model": "deepseek-chat",
            "context_window": 8192,
        }
    ],
    "defaults": {"chat": "deepseek"},
}


@pytest.fixture
def edit_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[ProviderCommand, Path]:
    """将全局 loader 指向临时配置文件并重置单例，返回 (命令, 配置文件路径)。"""
    config_file = tmp_path / "ai_providers.yaml"
    config_file.write_text(yaml.dump(PROVIDER_YAML), encoding="utf-8")
    monkeypatch.setattr(loader, "config_path", config_file)
    loader.invalidate_cache()
    monkeypatch.setattr(config_storage, "_cli_config", None)
    return ProviderCommand(), config_file


def _run_edit(
    cmd: ProviderCommand,
    monkeypatch: pytest.MonkeyPatch,
    shows: list[str | None],
    inputs: list[str | BaseException] = [],
) -> None:
    """驱动 _edit_provider：shows 依次喂给各菜单 show()，inputs 依次喂给 input()。"""
    show_iter = iter(shows)
    monkeypatch.setattr(InteractiveMenu, "show", lambda self: next(show_iter))

    input_iter = iter(inputs)

    def fake_input(prompt: str = "") -> str:
        item = next(input_iter)
        if isinstance(item, BaseException):
            raise item
        return item

    monkeypatch.setattr("builtins.input", fake_input)
    cmd._edit_provider()


def _read_config(config_file: Path) -> Any:
    return yaml.safe_load(config_file.read_text("utf-8"))


def _stored_provider(cmd: ProviderCommand) -> Any:
    """取出被测 Provider（必存在，缺失即测试环境错误）。"""
    provider = cmd._config.get_provider("deepseek")
    assert provider is not None
    return provider


class TestEditProviderDiscard:
    """项 2：ESC / 中断丢弃编辑副本，不落盘、不污染内存态。"""

    def test_esc_discards_changes(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ESC（show 返回 None）：配置文件与内存态均不变。"""
        cmd, config_file = edit_env
        before = config_file.read_text("utf-8")
        _run_edit(cmd, monkeypatch, shows=["deepseek", None])

        assert config_file.read_text("utf-8") == before
        assert _stored_provider(cmd).name == "DeepSeek"

    def test_interrupt_discards_changes(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """编辑中 KeyboardInterrupt：已改的副本被丢弃，磁盘与内存态均不变。"""
        cmd, config_file = edit_env
        before = config_file.read_text("utf-8")
        _run_edit(cmd, monkeypatch, shows=["deepseek", "name", "model"], inputs=["Renamed", KeyboardInterrupt()])

        assert config_file.read_text("utf-8") == before
        # 深拷贝保护：中断前对副本的 name 修改不污染存储内对象
        assert _stored_provider(cmd).name == "DeepSeek"

    def test_done_saves_changes(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """显式 "done"：正常保存修改到磁盘与内存态。"""
        cmd, config_file = edit_env
        _run_edit(cmd, monkeypatch, shows=["deepseek", "name", "done"], inputs=["Renamed"])

        assert _stored_provider(cmd).name == "Renamed"
        assert _read_config(config_file)["providers"][0]["name"] == "Renamed"


class TestEditContextWindow:
    """项 4：编辑 context_window 的非法输入保留原值，留空仍为 None。"""

    def test_invalid_text_keeps_original(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """非整数输入：原值 8192 保留（内存态与磁盘解析值均不变）。"""
        cmd, config_file = edit_env
        _run_edit(cmd, monkeypatch, shows=["deepseek", "context_window", "done"], inputs=["abc"])

        assert _stored_provider(cmd).context_window == 8192
        assert _read_config(config_file)["providers"][0]["context_window"] == 8192

    def test_invalid_below_min_keeps_original(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """小于 1024 的整数：视为非法输入，原值保留。"""
        cmd, config_file = edit_env
        _run_edit(cmd, monkeypatch, shows=["deepseek", "context_window", "done"], inputs=["100"])

        assert _stored_provider(cmd).context_window == 8192
        assert _read_config(config_file)["providers"][0]["context_window"] == 8192

    def test_empty_input_sets_none(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """直接回车（留空）：合法语义，context_window 置 None 并保存。"""
        cmd, config_file = edit_env
        _run_edit(cmd, monkeypatch, shows=["deepseek", "context_window", "done"], inputs=[""])

        assert _stored_provider(cmd).context_window is None
        assert _read_config(config_file)["providers"][0].get("context_window") is None

    def test_valid_value_updates(
        self, edit_env: tuple[ProviderCommand, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """合法整数（>= 1024）：正常更新并保存。"""
        cmd, config_file = edit_env
        _run_edit(cmd, monkeypatch, shows=["deepseek", "context_window", "done"], inputs=["16384"])

        assert _stored_provider(cmd).context_window == 16384
        assert _read_config(config_file)["providers"][0]["context_window"] == 16384
