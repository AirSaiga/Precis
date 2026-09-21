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
"""@fileoverview 2026-09-21 审计第三批 CLI 命令层项回归测试

覆盖：config check 隐藏目录假绿、migrate --language 枚举校验、config get
穿越防护、validate --table 尾部悬挂、display_relpath 跨盘符回退、
EDITOR 含参数拆分、交互菜单非 TTY 回退。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.cli.shell.commands.base import ProjectContext


def _make_ctx(project_root: str) -> ProjectContext:
    ctx = ProjectContext()
    ctx.project_path = project_root
    return ctx


class TestConfigCheckHiddenRoot:
    def test_project_inside_hidden_dir_not_false_green(self, tmp_path: Path):
        """项目位于隐藏目录下时 config check 仍遍历项目内文件（原 0 文件假绿）。"""
        from app.cli.shell.commands.config.check import ConfigCheckCommand

        proj = tmp_path / ".hidden" / "proj"
        proj.mkdir(parents=True)
        (proj / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")

        cmd = ConfigCheckCommand()
        result = cmd.execute([], _make_ctx(str(proj)))
        # 修复前：walk 根即被隐藏前缀剔除 → "所有 0 个配置文件格式正确" 假绿
        assert "0 个" not in result.message

    def test_hidden_subdirs_still_skipped(self, tmp_path: Path):
        """项目内的隐藏子目录（.git 等）仍被跳过。"""
        from app.cli.shell.commands.config.check import ConfigCheckCommand

        proj = tmp_path / "proj"
        (proj / ".git").mkdir(parents=True)
        (proj / ".git" / "config.yaml").write_text("x", encoding="utf-8")
        (proj / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")

        cmd = ConfigCheckCommand()
        result = cmd.execute([], _make_ctx(str(proj)))
        assert ".git" not in result.message


class TestMigrateLanguageEnum:
    def test_invalid_language_rejected_before_service(self, tmp_path: Path):
        """--language 非法值前置拒绝（枚举与 usage 声明一致）。"""
        from app.cli.shell.commands.ai.migrate import AIMigrateCommand

        proj = tmp_path / "proj"
        proj.mkdir()
        script = proj / "rules.py"
        script.write_text("print('x')\n", encoding="utf-8")

        cmd = AIMigrateCommand()
        result = cmd.execute([str(script), "--language", "cobol"], _make_ctx(str(proj)))
        assert result.success is False
        assert "--language" in result.message and "cobol" in result.message

    def test_valid_language_accepted_passthrough(self, tmp_path: Path, monkeypatch):
        """合法枚举不因校验被拒（回归：不能误伤既有用法）。"""
        from app.cli.shell.commands.ai import migrate as migrate_mod

        proj = tmp_path / "proj"
        proj.mkdir()
        script = proj / "rules.py"
        script.write_text("print('x')\n", encoding="utf-8")
        data = proj / "data.csv"
        data.write_text("id\n1\n", encoding="utf-8")

        # 门控 AI 依赖（裸装环境无 openai 时命令应停在门控而非 ImportError）
        monkeypatch.setattr(migrate_mod, "ai_dependencies_available", lambda: True, raising=False)

        called: dict = {}

        class _FakeService:
            def __init__(self, *a, **k):
                pass

            def migrate_from_script(self, **kwargs):
                called["language"] = kwargs.get("language")
                return {
                    "success": True,
                    "manifest": {"version": 2, "project": {"id": "p", "name": "p"}},
                    "schemas": {},
                    "constraints": {},
                    "regex_nodes": {},
                }

        monkeypatch.setattr(migrate_mod, "ConfigMigrationService", _FakeService)
        cmd = migrate_mod.AIMigrateCommand()
        cmd.execute([str(script), str(data), "--language", "sql"], _make_ctx(str(proj)))
        assert called.get("language") == "sql"


class TestConfigGetTraversal:
    def test_parent_reference_rejected(self, tmp_path: Path):
        """config get ../outside.yaml 不越项目读取（族内防护对齐）。"""
        from app.cli.shell.commands.config.get import ConfigGetCommand

        proj = tmp_path / "proj"
        proj.mkdir()
        outside = tmp_path / "outside.yaml"
        outside.write_text("secret: 1\n", encoding="utf-8")

        cmd = ConfigGetCommand()
        result = cmd.execute(["../outside.yaml", "secret"], _make_ctx(str(proj)))
        assert result.success is False
        assert "secret" not in (result.message or "")
        assert "1" not in (result.message or "")


class TestValidateDanglingOption:
    def test_trailing_table_option_rejected(self):
        """`validate --table`（尾部悬挂）报参数错误而非静默全表校验。"""
        from app.cli.shell.commands.validate import ValidateCommand

        cmd = ValidateCommand()
        result = cmd.execute(["--table"], ProjectContext())
        assert result.success is False
        assert result.exit_code == 2
        assert "--table" in result.message

    def test_option_value_slot_occupied_by_next_option_rejected(self):
        """`validate --table --format json` 值位被选项占据同样拒绝。"""
        from app.cli.shell.commands.validate import ValidateCommand

        cmd = ValidateCommand()
        result = cmd.execute(["--table", "--format", "json"], ProjectContext())
        assert result.success is False
        assert result.exit_code == 2


class TestDisplayRelpath:
    def test_same_root_returns_relative(self, tmp_path: Path):
        from app.shared.core.utils.path_utils import display_relpath

        assert display_relpath(str(tmp_path / "a" / "f.csv"), str(tmp_path)) == str(Path("a") / "f.csv")

    @pytest.mark.skipif(sys.platform != "win32", reason="跨盘符 relpath 仅 Windows 抛 ValueError")
    def test_cross_drive_falls_back_to_absolute(self):
        from app.shared.core.utils.path_utils import display_relpath

        result = display_relpath("C:/data/f.csv", "D:/proj")
        assert Path(result).is_absolute() or ":" in result  # 回退为绝对路径展示


class TestEditorArgSplit:
    def test_editor_with_args_split_before_launch(self, tmp_path: Path, monkeypatch):
        """EDITOR="code -w" 须拆分为两个 argv 元素再拼文件路径。"""
        import subprocess as _sp

        from app.cli.shell.commands.config.edit import ConfigEditCommand

        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")
        monkeypatch.setenv("EDITOR", "code -w")

        captured: dict = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            return _sp.CompletedProcess(cmd, 0)

        monkeypatch.setattr(_sp, "run", fake_run)
        cmd = ConfigEditCommand()
        result = cmd.execute([], _make_ctx(str(proj)))
        assert result.success is True
        assert captured["cmd"][:2] == ["code", "-w"]
        assert captured["cmd"][2].endswith("project.precis.yaml")


class TestMenuNonTtyFallback:
    def test_stdin_not_tty_uses_numbered_input(self, monkeypatch):
        """stdin 非 TTY（管道/CI）时回退编号选择而非 readchar。"""
        import builtins

        from app.cli.shell.interactive_menu import InteractiveMenu

        menu = InteractiveMenu("选择:")
        menu.add_item("a", "选项A")
        menu.add_item("b", "选项B")
        monkeypatch.setattr(InteractiveMenu, "_stdin_is_interactive", lambda self: False)
        monkeypatch.setattr(builtins, "input", lambda *a, **k: "2")

        assert menu.show() == "b"

    def test_stdin_eof_returns_none(self, monkeypatch):
        """管道立即 EOF（空输入）时返回 None 不崩。"""
        import builtins

        from app.cli.shell.interactive_menu import InteractiveMenu

        menu = InteractiveMenu("选择:")
        menu.add_item("a", "选项A")
        monkeypatch.setattr(InteractiveMenu, "_stdin_is_interactive", lambda self: False)

        def _eof(*a, **k):
            raise EOFError

        monkeypatch.setattr(builtins, "input", _eof)
        assert menu.show() is None
