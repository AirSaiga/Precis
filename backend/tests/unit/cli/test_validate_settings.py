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
@fileoverview validate 命令 settings 读取测试

历史缺陷：standalone 模式传空 settings（清单内 timeout_seconds/error_handling
被忽略）；REPL 模式从清单 dump 顶层读 "validation"（实际嵌套在 settings 下）恒
miss——两条路径的项目 settings 从未生效。本文件锁定两路径均正确读取。
"""

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import (
    ValidateCommand,
    _extract_settings,
    _load_manifest_settings,
)


class TestExtractSettings:
    def test_nested_manifest_shape(self):
        config = {
            "version": 2,
            "project": {"id": "p1", "name": "P"},
            "settings": {
                "validation": {"timeout_seconds": 60, "error_handling": "stop"},
                "script_security": {"allow_eval": True},
            },
        }
        validation, script = _extract_settings(config)
        assert validation == {"timeout_seconds": 60, "error_handling": "stop"}
        assert script == {"allow_eval": True}

    def test_top_level_shape_compat(self):
        config = {"validation": {"timeout_seconds": 10}, "script_security": {"allow_eval": False}}
        validation, script = _extract_settings(config)
        assert validation == {"timeout_seconds": 10}
        assert script == {"allow_eval": False}

    def test_empty_config(self):
        assert _extract_settings(None) == ({}, {})
        assert _extract_settings({}) == ({}, {})


class TestStandaloneReadsManifestSettings:
    def test_manifest_settings_passed_through(self, tmp_path, monkeypatch):
        """standalone 模式必须把清单内 settings 传给 _run_validation（旧实现恒空）。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: p1
  name: demo
settings:
  validation:
    timeout_seconds: 60
    error_handling: stop
  script_security:
    allow_eval: true
""",
            encoding="utf-8",
        )
        captured: dict = {}

        def fake_run(self, manifest_path, data_dir, table_name, validation_settings, script_security, *a, **k):
            captured["validation"] = validation_settings
            captured["script"] = script_security
            from app.cli.shell.commands.base import CommandResult

            return CommandResult.ok("ok")

        monkeypatch.setattr(ValidateCommand, "_run_validation", fake_run)
        cmd = ValidateCommand()
        result = cmd.execute(["--manifest", str(manifest)], ProjectContext())
        assert result.success
        assert captured["validation"].get("timeout_seconds") == 60
        assert captured["validation"].get("error_handling") == "stop"
        assert captured["script"].get("allow_eval") is True

    def test_manifest_without_settings_falls_back_to_defaults(self, tmp_path, monkeypatch):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text("version: 2\nproject:\n  id: p1\n  name: demo\n", encoding="utf-8")
        assert _load_manifest_settings(str(manifest)) == ({}, {})

    def test_unreadable_manifest_falls_back(self, tmp_path):
        bad = tmp_path / "broken.precis.yaml"
        bad.write_text("::: not yaml [", encoding="utf-8")
        assert _load_manifest_settings(str(bad)) == ({}, {})


class TestShellReadsProjectConfigSettings:
    def test_nested_project_config(self, monkeypatch, tmp_path):
        """REPL 模式从 project_config（清单 dump）正确提取嵌套 settings（旧实现顶层恒 miss）。"""
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text("version: 2\nproject:\n  id: p1\n  name: demo\n", encoding="utf-8")
        captured: dict = {}

        def fake_run(self, manifest_path, data_dir, table_name, validation_settings, script_security, *a, **k):
            captured["validation"] = validation_settings
            captured["script"] = script_security
            from app.cli.shell.commands.base import CommandResult

            return CommandResult.ok("ok")

        monkeypatch.setattr(ValidateCommand, "_run_validation", fake_run)
        ctx = ProjectContext()
        ctx.project_path = str(tmp_path)
        ctx.project_config = {
            "version": 2,
            "settings": {
                "validation": {"timeout_seconds": 99},
                "script_security": {"allow_eval": True, "sandbox_mode": False},
            },
        }
        result = ValidateCommand().execute([], ctx)
        assert result.success
        assert captured["validation"].get("timeout_seconds") == 99
        assert captured["script"].get("allow_eval") is True
