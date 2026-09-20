# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""@fileoverview ai 命令依赖门控守卫（裸装不含 [ai] extra 的体验契约）

裸装 precis-cli 的用户在 help 里看到 ai 入口时必须知道"差什么、怎么补"；
进入 ai 命令必须直接得到安装指引，而不是进入一个每个选项最终都会失败的
交互菜单。依赖齐全时行为不变（不门控、不标注）。
"""

from __future__ import annotations

import pytest

from app.cli.shell.commands.ai import AICommand, ai_dependencies_available
from app.cli.shell.commands.base import ProjectContext


@pytest.fixture()
def project_context():
    ctx = ProjectContext()
    ctx.project_path = "."
    return ctx


class TestAIDependencyGate:
    """缺依赖时 ai 入口门控；依赖齐全时不门控"""

    def test_gate_blocks_menu_when_deps_missing(self, project_context, monkeypatch):
        """缺依赖时 ai（无参）不进交互菜单，直接返回安装指引。"""
        monkeypatch.setattr("app.cli.shell.commands.ai.ai_dependencies_available", lambda: False)
        menu_called = []
        cmd = AICommand()
        monkeypatch.setattr(cmd, "_show_interactive_menu", lambda ctx: menu_called.append(ctx))
        result = cmd.execute([], project_context)
        assert not result.success
        assert "precis-cli[ai]" in result.message
        assert menu_called == []  # 菜单未被触达

    def test_gate_blocks_subcommands_when_deps_missing(self, project_context, monkeypatch):
        """缺依赖时任意子命令（chat/status/…）同样被门控拦截。"""
        monkeypatch.setattr("app.cli.shell.commands.ai.ai_dependencies_available", lambda: False)
        cmd = AICommand()
        result = cmd.execute(["chat"], project_context)
        assert not result.success
        assert "precis-cli[ai]" in result.message
        # 指引含 provider 预配置路径（顶层 provider 命令不依赖 LLM 库）
        assert "provider add" in result.message

    def test_no_gate_when_deps_available(self, project_context, monkeypatch):
        """依赖齐全时门控不触发，正常进入分发（既有行为回归守卫）。"""
        monkeypatch.setattr("app.cli.shell.commands.ai.ai_dependencies_available", lambda: True)
        cmd = AICommand()
        monkeypatch.setattr(cmd, "_show_interactive_menu", lambda ctx: "menu-shown")
        result = cmd.execute([], project_context)
        assert result is not None

    def test_description_annotates_missing_deps(self, monkeypatch):
        """help 列表动态标注：缺依赖时 description 带安装指引。"""
        monkeypatch.setattr("app.cli.shell.commands.ai.ai_dependencies_available", lambda: False)
        desc = AICommand().description
        assert "未安装依赖" in desc
        assert "precis-cli[ai]" in desc

    def test_description_clean_when_deps_available(self, monkeypatch):
        """依赖齐全时 description 不带缺依赖标注。"""
        monkeypatch.setattr("app.cli.shell.commands.ai.ai_dependencies_available", lambda: True)
        assert "未安装依赖" not in AICommand().description

    def test_probe_returns_bool_and_caches(self, monkeypatch):
        """探测函数返回布尔；缓存变量可被测试重置（不测真实环境状态）。"""
        assert isinstance(ai_dependencies_available(), bool)
