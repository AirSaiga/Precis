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
"""@fileoverview INIT_PROJECT 动作与"项目未初始化"防线单元测试

背景（TUI 打开仅有数据文件的目录后 AI 初始化项目失败的修复）：
- 显式入口：INIT_PROJECT 动作创建 project.precis.yaml 脚手架
- 预验证防线：manifest 缺失时拦截非 INIT 写动作并给出初始化指引
- 孤儿文件防线：绕过验证器直接写资源时自动补 manifest 登记（纵深防御）
- 错误信息指引：自检/校验/设置三处失败信息引导 INIT_PROJECT
- read_project 透出 manifest_exists 状态
"""

from __future__ import annotations

import asyncio
import os

import yaml

from app.shared.services.ai.agent.chat_tools.apply_actions import _post_write_self_check
from app.shared.services.ai.agent.chat_tools.read_project import ReadProjectTool
from app.shared.services.llm.actions.action_processor import process_actions
from app.shared.services.llm.actions.action_validator import ActionValidator
from app.shared.services.llm.actions.settings_handlers import process_settings_action
from app.shared.services.llm.validate_executor import execute_validate_project

MANIFEST_NAME = "project.precis.yaml"


def _write_min_manifest(workspace: str) -> None:
    """预置最小 manifest（模拟已初始化项目）。"""
    with open(os.path.join(workspace, MANIFEST_NAME), "w", encoding="utf-8") as f:
        yaml.safe_dump({"version": 2, "project": {"id": "p1", "name": "p1"}, "schemas": []}, f)


def _init_action(name: str | None = None) -> dict:
    action: dict = {"actionType": "INIT_PROJECT"}
    if name:
        action["projectSpec"] = {"name": name}
    return action


def _add_schema_action() -> dict:
    return {
        "actionType": "ADD_SCHEMA",
        "schemaSpec": {
            "name": "my_table",
            "schemaId": "my_table",
            "columns": [
                {"name": "col1", "type": "integer"},
                {"name": "col2", "type": "string"},
            ],
        },
    }


# =============================================================================
# INIT_PROJECT 处理器
# =============================================================================


class TestInitProjectHandler:
    """process_actions 执行 INIT_PROJECT 的行为"""

    def test_creates_scaffold(self, tmp_path):
        """初始化创建 manifest + 标准子目录，结构合法可被 Manifest 模型装载。"""
        workspace = str(tmp_path)
        result = process_actions([_init_action("Demo")], workspace)

        assert result["success"] is True
        manifest_path = os.path.join(workspace, MANIFEST_NAME)
        assert os.path.isfile(manifest_path)
        with open(manifest_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["version"] == 2
        assert data["project"]["name"] == "Demo"
        assert data["project"]["id"] == "demo"
        assert data["schemas"] == []

        # 标准子目录已创建
        for sub in ["schemas", "constraints", "transforms", "data"]:
            assert os.path.isdir(os.path.join(workspace, sub)), f"缺少子目录: {sub}"

        # 写出的 manifest 可被 Manifest 模型装载（roundtrip 完整性）
        from app.shared.core.project.manifest.reader import load_manifest

        manifest = load_manifest(manifest_path)
        assert manifest.schemas == []

        # manifest 不是画布资源实体，不产生变更集指令
        assert result["results"][0]["frontendInstructions"] is None

    def test_name_defaults_to_directory_basename(self, tmp_path):
        """projectSpec 省略时项目名取目录名。"""
        workspace = str(tmp_path / "myproj")
        os.makedirs(workspace)

        result = process_actions([{"actionType": "INIT_PROJECT"}], workspace)

        assert result["success"] is True
        with open(os.path.join(workspace, MANIFEST_NAME), encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["project"]["name"] == "myproj"
        assert data["project"]["id"] == "myproj"

    def test_rejects_existing_manifest(self, tmp_path):
        """manifest 已存在时拒绝初始化（幂等保护，不覆盖既有清单）。"""
        workspace = str(tmp_path)
        _write_min_manifest(workspace)

        result = process_actions([_init_action("X")], workspace)

        assert result["success"] is False
        assert "已存在" in result["results"][0]["message"]


# =============================================================================
# 预验证防线（manifest 缺失引导初始化）
# =============================================================================


class TestValidatorBootstrapGuard:
    """ActionValidator 对未初始化项目的拦截与引导"""

    def test_write_action_blocked_with_init_guidance(self, tmp_path):
        """manifest 缺失时写动作被拦截，错误信息引导 INIT_PROJECT。"""
        validator = ActionValidator(str(tmp_path))
        result = validator.validate([_add_schema_action()])

        assert result.has_errors
        err = result.errors[0]
        assert err.error_type == "manifest_missing"
        assert "INIT_PROJECT" in err.suggestion

    def test_settings_blocked_when_uninitialized(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_SETTINGS",
                    "settingsSpec": {"category": "validation", "settings": {"timeout_seconds": 60}},
                }
            ]
        )
        assert result.has_errors
        assert result.errors[0].error_type == "manifest_missing"

    def test_init_project_valid_when_manifest_missing(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate([_init_action()])
        assert not result.has_errors
        assert result.valid_actions == [_init_action()]

    def test_init_project_rejected_when_manifest_exists(self, tmp_path):
        workspace = str(tmp_path)
        _write_min_manifest(workspace)

        validator = ActionValidator(workspace)
        result = validator.validate([_init_action()])

        assert result.has_errors
        assert result.errors[0].error_type == "manifest_already_exists"

    def test_readonly_actions_pass_when_uninitialized(self, tmp_path):
        """只读动作（VALIDATE_PROJECT）不受 manifest 缺失拦截。"""
        validator = ActionValidator(str(tmp_path))
        result = validator.validate([{"actionType": "VALIDATE_PROJECT"}])
        assert not result.has_errors


# =============================================================================
# 孤儿文件防线（绕过验证器的纵深防御）
# =============================================================================


class TestOrphanPreventionFallback:
    """manifest 缺失时直接写资源（无预验证路径）不再产出孤儿文件"""

    def test_add_schema_bootstraps_manifest(self, tmp_path):
        """ADD_SCHEMA 在无 manifest 目录执行后，清单自动补建并登记引用。"""
        workspace = str(tmp_path)
        result = process_actions([_add_schema_action()], workspace)

        assert result["success"] is True
        assert os.path.isfile(os.path.join(workspace, "schemas", "my_table.schema.yaml"))

        manifest_path = os.path.join(workspace, MANIFEST_NAME)
        assert os.path.isfile(manifest_path), "manifest 未自动补建，schema 成为孤儿文件"
        with open(manifest_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        registered = [ref.get("id") for ref in data.get("schemas", [])]
        assert "my_table" in registered


# =============================================================================
# dry-run diff（两阶段确认的预览链路）
# =============================================================================


class TestInitProjectDiff:
    def test_diff_shows_manifest_creation(self, tmp_path):
        """INIT_PROJECT 的确认预览应把 manifest 列为 created 文件。"""
        from app.shared.services.llm.actions.diff_compute import compute_action_diff

        workspace = str(tmp_path)
        diff = compute_action_diff([_init_action("Demo")], workspace)

        assert diff.success is True
        created = [f.path for f in diff.files if f.status == "created"]
        assert MANIFEST_NAME in created
        assert diff.summary["created"] >= 1

    def test_diff_on_initialized_project_fails(self, tmp_path):
        """manifest 已存在时 dry-run 执行失败（handler 拒绝），diff 不成功。"""
        from app.shared.services.llm.actions.diff_compute import compute_action_diff

        workspace = str(tmp_path)
        _write_min_manifest(workspace)

        diff = compute_action_diff([_init_action()], workspace)

        assert diff.success is False
        assert "已存在" in (diff.error or "")


# =============================================================================
# 端到端：TUI 场景（无 manifest 目录 → 初始化 → 建表 → 校验可运行）
# =============================================================================


class TestBootstrapEndToEnd:
    def test_init_then_add_schema_then_validate_runs(self, tmp_path):
        """模拟用户两批操作：先 INIT_PROJECT，再 ADD_SCHEMA，校验链路可用。"""
        workspace = str(tmp_path)

        # 第一批：初始化（预验证通过 + 写盘成功）
        validator = ActionValidator(workspace)
        assert not validator.validate([_init_action()]).has_errors
        init_result = process_actions([_init_action()], workspace)
        assert init_result["success"] is True

        # 第二批：建表（预验证不再被 manifest_missing 拦截）
        validator2 = ActionValidator(workspace)
        assert not validator2.validate([_add_schema_action()]).has_errors
        add_result = process_actions([_add_schema_action()], workspace)
        assert add_result["success"] is True

        # 校验链路可用（空数据文件 → 校验流程执行成功，错误数为 0）
        with open(os.path.join(workspace, "my_table.csv"), "w", encoding="utf-8") as f:
            f.write("col1,col2\n1,a\n")
        validate_result = execute_validate_project(workspace)
        assert validate_result["success"] is True
        assert (validate_result.get("details") or {}).get("error_count", 0) == 0


# =============================================================================
# 错误信息指引
# =============================================================================


class TestErrorMessagesGuidance:
    """三处失败信息都引导 LLM 走 INIT_PROJECT 自我修正"""

    def test_self_check_reports_uninitialized(self, tmp_path):
        text = _post_write_self_check(str(tmp_path))
        assert text.startswith("## 写盘后自动校验")
        assert "未初始化" in text
        assert "INIT_PROJECT" in text

    def test_validate_executor_message_guides_init(self, tmp_path):
        result = execute_validate_project(str(tmp_path))
        assert result["success"] is False
        assert "INIT_PROJECT" in result["message"]

    def test_settings_message_guides_init(self, tmp_path):
        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "validation", "settings": {"timeout_seconds": 60}},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "INIT_PROJECT" in result["message"]


# =============================================================================
# read_project 初始化状态透出
# =============================================================================


class TestReadProjectManifestFlag:
    def test_flag_false_with_hint_when_uninitialized(self, tmp_path):
        tool = ReadProjectTool(str(tmp_path))
        result = asyncio.run(tool.run({}))
        assert result["success"] is True
        assert result["manifest_exists"] is False
        assert "INIT_PROJECT" in result["manifest_hint"]

    def test_flag_true_when_initialized(self, tmp_path):
        _write_min_manifest(str(tmp_path))
        tool = ReadProjectTool(str(tmp_path))
        result = asyncio.run(tool.run({}))
        assert result["success"] is True
        assert result["manifest_exists"] is True
        assert "manifest_hint" not in result
