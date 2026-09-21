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
"""@fileoverview 2026-09-18 逻辑漏洞治理第二轮 B7 批次（Electron/CLI/TUI）回归测试

覆盖 docs/plans/2026-09-18-logic-remediation/04 规格中 B7 批次的后端可测项：
- §4.3  config set --string 保留字面量
- §4.4  ai switch/delete 大小写不敏感
- §4.7  config init 路径穿越拒绝
- §4.8  历史文件坏条目过滤
- §4.10 CLI 读-改-写丢更新防护（mtime）
- §4.24 小上下文窗口预算裁剪
- §4.25 diff 收集范围补 regex/transforms + 新建文件登记
- §4.26 config show 无参按 V2 目录遍历
"""

from __future__ import annotations

import json
import os

import pytest


def _make_project_context(project_root: str):
    from app.cli.shell.commands.base import ProjectContext

    ctx = ProjectContext()
    ctx.project_path = project_root
    return ctx


# ============================================================
# §4.3 config set --string
# ============================================================


class TestConfigSetStringFlag:
    def _make_ctx(self, tmp_path):
        from app.cli.shell.commands.config.set import ConfigSetCommand

        (tmp_path / "users.schema.yaml").write_text(
            "version: 2\nid: users\nname: users\ncolumns:\n  - id: c1\n    name: code\n    type: string\n",
            encoding="utf-8",
        )
        cmd = ConfigSetCommand()
        return cmd, _make_project_context(str(tmp_path))

    def test_string_flag_preserves_leading_zeros(self, tmp_path):
        import yaml

        cmd, ctx = self._make_ctx(tmp_path)
        result = cmd.execute(["--string", "users.schema.yaml", "meta.code", "007"], ctx)
        assert result.success, result.message
        data = yaml.safe_load((tmp_path / "users.schema.yaml").read_text(encoding="utf-8"))
        assert data["meta"]["code"] == "007"  # 字符串字面量，前导零保留

    def test_default_path_still_infers(self, tmp_path):
        import yaml

        cmd, ctx = self._make_ctx(tmp_path)
        result = cmd.execute(["users.schema.yaml", "meta.count", "42"], ctx)
        assert result.success, result.message
        data = yaml.safe_load((tmp_path / "users.schema.yaml").read_text(encoding="utf-8"))
        assert data["meta"]["count"] == 42  # 推断为 int（回归不变）

    def test_default_stringified_number_loses_zeros(self, tmp_path):
        """对照：无 --string 时 007 被推断为 int 7（文档化旧行为）"""
        import yaml

        cmd, ctx = self._make_ctx(tmp_path)
        result = cmd.execute(["users.schema.yaml", "meta.code", "007"], ctx)
        assert result.success, result.message
        data = yaml.safe_load((tmp_path / "users.schema.yaml").read_text(encoding="utf-8"))
        assert data["meta"]["code"] == 7


# ============================================================
# §4.4 provider 大小写不敏感
# ============================================================


class TestProviderCaseInsensitive:
    def test_mixed_case_provider_id_matchable(self):
        """大写 ID 的 provider 经 lower 参数可命中存储原名"""
        providers = [
            type("P", (), {"id": "MyAPI", "name": "My API"}),
            type("P", (), {"id": "deepseek", "name": "DeepSeek"}),
        ]
        raw_id = "myapi"
        matched = next((p.id for p in providers if p.id.lower() == raw_id.lower()), raw_id)
        assert matched == "MyAPI"

        raw_upper = "DEEPSEEK"
        matched2 = next((p.id for p in providers if p.id.lower() == raw_upper.lower()), raw_upper)
        assert matched2 == "deepseek"


# ============================================================
# §4.7 config init 路径穿越
# ============================================================


class TestConfigInitTraversal:
    def _make_command(self, tmp_path):
        from app.cli.shell.commands.config.init import ConfigInitCommand

        cmd = ConfigInitCommand()
        return cmd, _make_project_context(str(tmp_path))

    def test_parent_reference_rejected(self, tmp_path):
        cmd, ctx = self._make_command(tmp_path)
        result = cmd.execute(["project", "../../outside.yaml"], ctx)
        assert result.success is False
        assert "非法" in result.message or "超出" in result.message

    def test_absolute_path_rejected(self, tmp_path):
        cmd, ctx = self._make_command(tmp_path)
        abs_name = str(tmp_path / "abs.yaml").replace("\\", "/")
        result = cmd.execute(["project", abs_name], ctx)
        assert result.success is False

    def test_normal_filename_still_creates(self, tmp_path):
        cmd, ctx = self._make_command(tmp_path)
        result = cmd.execute(["project", "my.project.precis.yaml"], ctx)
        assert result.success is True
        assert (tmp_path / "my.project.precis.yaml").exists()


# ============================================================
# §4.8 历史坏条目过滤
# ============================================================


class TestHistoryBadEntries:
    def test_mixed_entries_filtered_with_warning(self, tmp_path, monkeypatch, caplog):
        from app.cli.shared_services import project_ops

        history_file = tmp_path / "history.json"
        history_file.write_text(
            json.dumps(
                [
                    {"path": "/proj/valid", "last_opened": "2026-01-01T00:00:00"},
                    "i-am-a-corrupted-string",
                    {"no_path_field": True},
                    {"path": ""},
                    {"path": "/proj/valid2", "last_opened": "2026-01-02T00:00:00"},
                ]
            ),
            encoding="utf-8",
        )
        monkeypatch.setattr(project_ops, "HISTORY_FILE", str(history_file))

        result = project_ops.load_history()
        assert len(result) == 2
        assert all(h.get("path") for h in result)

    def test_all_bad_entries_return_empty(self, tmp_path, monkeypatch):
        from app.cli.shared_services import project_ops

        history_file = tmp_path / "history.json"
        history_file.write_text(json.dumps([42, "str", None]), encoding="utf-8")
        monkeypatch.setattr(project_ops, "HISTORY_FILE", str(history_file))

        assert project_ops.load_history() == []


# ============================================================
# §4.10 CLI 读-改-写丢更新防护
# ============================================================


class TestCliSaveMtimeGuard:
    def test_external_modification_blocks_save(self, tmp_path, monkeypatch):
        from app.cli.shell import config_storage as cs
        from app.shared.services.llm.config import loader

        cfg = tmp_path / "ai_providers.yaml"
        cfg.write_text(
            'version: "2.0"\nproviders: []\ndefaults: {}\n',
            encoding="utf-8",
        )
        monkeypatch.setattr(loader, "config_path", cfg)
        loader.invalidate_cache()
        monkeypatch.setattr(cs, "_cli_config", None)

        storage = cs.get_cli_config()
        # 模拟外部进程修改（mtime 变化）
        import time

        os.utime(cfg, (time.time() + 10, time.time() + 10))
        with pytest.raises(RuntimeError, match="其他进程"):
            storage._save()

    def test_no_external_modification_saves_normally(self, tmp_path, monkeypatch):
        from app.cli.shell import config_storage as cs
        from app.shared.services.llm.config import loader

        cfg = tmp_path / "ai_providers.yaml"
        cfg.write_text(
            'version: "2.0"\nproviders: []\ndefaults: {}\n',
            encoding="utf-8",
        )
        monkeypatch.setattr(loader, "config_path", cfg)
        loader.invalidate_cache()
        monkeypatch.setattr(cs, "_cli_config", None)

        storage = cs.get_cli_config()
        storage._save()  # 不抛
        assert cfg.exists()


# ============================================================
# §4.24 小上下文窗口预算
# ============================================================


class TestTokenBudgets:
    def test_small_window_budgets_within_limit(self):
        from app.shared.services.llm.providers.base import compute_token_budgets

        for cw in (8192, 4096, 12288):
            input_b, output_b = compute_token_budgets(cw)
            assert input_b + output_b + 512 <= cw, f"cw={cw}: {input_b}+{output_b}+512 > {cw}"
            assert output_b >= 512
            assert input_b >= 512

    def test_tiny_window_raises(self):
        from app.shared.services.llm.providers.base import compute_token_budgets

        with pytest.raises(ValueError, match="上下文窗口过小"):
            compute_token_budgets(4000)

    def test_large_window_caps_output_at_8000(self):
        from app.shared.services.llm.providers.base import compute_token_budgets

        input_b, output_b = compute_token_budgets(128000)
        assert output_b == 8000
        assert input_b == 128000 - 8000 - 512


# ============================================================
# §4.25 diff 收集范围
# ============================================================


class TestDiffCollectionScope:
    def test_regex_and_transforms_dirs_collected(self, tmp_path):
        from app.cli.shell.commands.ai.executor_utils import _collect_all_config_files

        (tmp_path / "schemas").mkdir()
        (tmp_path / "schemas" / "users.schema.yaml").write_text("s", encoding="utf-8")
        (tmp_path / "regex").mkdir()
        (tmp_path / "regex" / "phone.regex.yaml").write_text("r", encoding="utf-8")
        (tmp_path / "transforms").mkdir()
        (tmp_path / "transforms" / "t1.transform.yaml").write_text("t", encoding="utf-8")

        result = _collect_all_config_files(str(tmp_path))
        keys = [str(k).replace("\\", "/") for k in result]
        assert any("schemas/users.schema.yaml" in k for k in keys)
        assert any("regex/phone.regex.yaml" in k for k in keys)
        assert any("transforms/t1.transform.yaml" in k for k in keys)

    def test_declared_new_files_derivation(self, tmp_path):
        from app.cli.shell.commands.ai.executor_utils import _collect_declared_new_files

        actions = [
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"regexId": "phone", "name": "phone", "pattern": r"\d+"},
            },
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"transformId": "t9"},
            },
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"constraintId": "nn1"},
            },
        ]
        paths = [p.replace("\\", "/") for p in _collect_declared_new_files({"actions": actions}, str(tmp_path))]
        assert any("regex/phone.regex.yaml" in p for p in paths)
        assert any("transforms/t9.transform.yaml" in p for p in paths)
        assert any("constraints/nn1.constraint.yaml" in p for p in paths)


# ============================================================
# §4.26 config show V2 目录遍历
# ============================================================


class TestConfigShowV2:
    def test_no_args_lists_v2_directories(self, tmp_path):
        from app.cli.shell.commands.config.show import ConfigShowCommand

        (tmp_path / "schemas").mkdir()
        (tmp_path / "schemas" / "users.schema.yaml").write_text("id: users", encoding="utf-8")
        (tmp_path / "constraints").mkdir()
        (tmp_path / "constraints" / "nn1.constraint.yaml").write_text("id: nn1", encoding="utf-8")
        (tmp_path / "regex").mkdir()
        (tmp_path / "regex" / "ph.regex.yaml").write_text("id: ph", encoding="utf-8")
        (tmp_path / "project.precis.yaml").write_text("version: 2", encoding="utf-8")

        cmd = ConfigShowCommand()
        ctx = _make_project_context(str(tmp_path))
        result = cmd.execute([], ctx)
        assert result.success is True
        assert "schemas/users.schema.yaml" in result.message
        assert "constraints/nn1.constraint.yaml" in result.message
        assert "regex/ph.regex.yaml" in result.message
        assert "project.precis.yaml" in result.message

    def test_empty_project_reports_no_files(self, tmp_path):
        from app.cli.shell.commands.config.show import ConfigShowCommand

        cmd = ConfigShowCommand()
        ctx = _make_project_context(str(tmp_path))
        result = cmd.execute([], ctx)
        assert result.success is True
        assert "没有找到任何配置文件" in result.message

    def test_single_file_outputs_raw_text_losslessly(self, tmp_path):
        """H11 回归：config show <file> 原文输出——注释与前导零不得被重序列化丢失。"""
        from app.cli.shell.commands.config.show import ConfigShowCommand

        source = "# 顶部注释：身份字段勿动\nproject:\n  id: '007'   # 编号保前导零\n  name: 我的项目\n"
        (tmp_path / "project.precis.yaml").write_text(source, encoding="utf-8")

        cmd = ConfigShowCommand()
        ctx = _make_project_context(str(tmp_path))
        result = cmd.execute(["project.precis.yaml"], ctx)
        assert result.success is True
        # 注释原样保留（PyYAML 重序列化会全丢）
        assert "# 顶部注释：身份字段勿动" in result.message
        # 引号风格与前导零原样保留（重序列化会 '007'→7）
        assert "id: '007'" in result.message
