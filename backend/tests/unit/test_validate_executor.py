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
"""@fileoverview validate_executor 单元测试

覆盖 execute_validate_project 的校验执行和错误格式化逻辑。
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.shared.services.llm.validate_executor import execute_validate_project


@pytest.fixture
def _mock_executor():
    with patch("app.shared.services.validation.executor.ValidationExecutor") as MockCls:
        yield MockCls


class TestExecuteValidateProject:
    def test_missing_manifest_returns_failure(self, tmp_path):
        result = execute_validate_project(str(tmp_path))
        assert result["success"] is False
        assert "不存在" in result["message"]
        assert result["details"] is None

    def test_successful_validation_no_errors(self, tmp_path, _mock_executor):
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {"errors": [], "loading_errors": [], "duration_ms": 50}
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert result["success"] is True
        assert "通过" in result["message"]
        assert result["details"]["error_count"] == 0
        assert result["details"]["has_errors"] is False
        assert result["details"]["has_loading_errors"] is False

    def test_validation_with_errors(self, tmp_path, _mock_executor):
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [
                {"type": "NotNull", "table": "users", "column": "email", "message": "空值"},
            ],
            "loading_errors": [],
            "duration_ms": 100,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert result["success"] is True
        assert result["details"]["error_count"] == 1
        assert result["details"]["has_errors"] is True
        assert "users.email" in result["message"]

    def test_error_without_column(self, tmp_path, _mock_executor):
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [
                {"type": "Unique", "table": "users", "message": "重复"},
            ],
            "loading_errors": [],
            "duration_ms": 10,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert "users:" in result["message"]

    def test_truncates_errors_beyond_10(self, tmp_path, _mock_executor):
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        errors = [{"type": "NotNull", "table": "t", "column": f"c{i}", "message": "bad"} for i in range(15)]
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {"errors": errors, "loading_errors": [], "duration_ms": 200}
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert result["details"]["error_count"] == 15
        assert "还有 5 个错误" in result["message"]
        assert len(result["details"]["errors"]) == 15

    def test_exception_returns_failure(self, tmp_path, _mock_executor):
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        _mock_executor.side_effect = RuntimeError("boom")

        result = execute_validate_project(str(tmp_path))
        assert result["success"] is False
        assert "boom" in result["message"]

    def test_table_filter_passed_through(self, tmp_path, _mock_executor):
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {"errors": [], "loading_errors": [], "duration_ms": 10}
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path), table_filter="users")
        assert result["details"]["table_filter"] == "users"

    # --- loading_errors 测试 ---

    def test_loading_errors_surface_when_no_errors(self, tmp_path, _mock_executor):
        """无校验错误但有加载警告时，message 应提示加载警告而非'校验通过'。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [],
            "loading_errors": [
                {"error_type": "SchemaNotFound", "table": "orders", "message": "schema 文件不存在"},
            ],
            "duration_ms": 30,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert result["success"] is True
        assert result["details"]["error_count"] == 0
        assert result["details"]["has_errors"] is False
        assert result["details"]["has_loading_errors"] is True
        assert len(result["details"]["loading_errors"]) == 1
        assert "加载警告" in result["message"]
        assert "SchemaNotFound" in result["message"]

    def test_loading_errors_and_errors_both_present(self, tmp_path, _mock_executor):
        """同时有校验错误和加载警告时，message 应同时包含两者。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [
                {"error_type": "NotNullViolation", "table": "users", "column": "email", "message": "空值"},
            ],
            "loading_errors": [
                {"error_type": "SourceNotFound", "table": "orders", "message": "数据文件不存在"},
            ],
            "duration_ms": 50,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert result["details"]["error_count"] == 1
        assert result["details"]["has_errors"] is True
        assert result["details"]["has_loading_errors"] is True
        assert "users.email" in result["message"]
        assert "加载警告" in result["message"]
        assert "SourceNotFound" in result["message"]

    def test_loading_errors_truncated_in_message(self, tmp_path, _mock_executor):
        """loading_errors 超过 10 条时，message 显示截断提示，details 保留前 20 条。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        loading_errors = [{"error_type": "SourceNotFound", "message": f"文件{i}不存在"} for i in range(15)]
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [],
            "loading_errors": loading_errors,
            "duration_ms": 10,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert "还有 5 个加载警告" in result["message"]
        assert len(result["details"]["loading_errors"]) == 15

    def test_error_type_field_read_correctly(self, tmp_path, _mock_executor):
        """格式化逻辑应读取 error_type 字段（真实数据用此键，而非 type）。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [
                {"error_type": "NotNullViolation", "table": "users", "column": "name", "message": "空值"},
            ],
            "loading_errors": [],
            "duration_ms": 10,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))
        assert "NotNullViolation" in result["message"]


# =============================================================================
# Scripted 权限跳过分离测试（防止"权限未开启"被误报为数据违规）
# =============================================================================


def _permission_skip_entry(name: str = "score_check") -> dict:
    """构造 scripted.py eval 门禁产出的权限跳过条目（引擎真实形状）。"""
    return {
        "error_type": "PermissionError",
        "error_code": "SCRIPTED_PERMISSION_DENIED",
        "error_params": {"name": name},
        "table": "users",
        "message": f"脚本约束「{name}」已跳过：项目设置中的『允许执行脚本 eval』尚未开启。",
    }


class TestScriptedPermissionSkipSeparation:
    """默认部署（allow_unsafe_eval=False）下，Scripted 约束的权限跳过条目
    不得计入 error_count——否则 validate_table / apply 写盘自检会把权限提示
    误报成"发现 N 个违规"。跳过单列到 skipped_scripted*，message 附注。
    """

    def test_skip_not_counted_alongside_real_violation(self, tmp_path, _mock_executor):
        """1 条真实违规 + 1 条权限跳过 → error_count=1，跳过单列，message 同时呈现。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        real_error = {"error_type": "NotNullViolation", "table": "users", "column": "email", "message": "空值"}
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [real_error, _permission_skip_entry()],
            "loading_errors": [],
            "duration_ms": 20,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))

        assert result["details"]["error_count"] == 1
        assert result["details"]["has_errors"] is True
        # details.errors 只保留真实违规，权限跳过不挤占 20 条详情位
        assert result["details"]["errors"] == [real_error]
        assert result["details"]["skipped_scripted_count"] == 1
        assert len(result["details"]["skipped_scripted"]) == 1
        # message：违规计数只算 1，跳过以附注呈现（不写成"2 个数据错误"）
        assert "发现 1 个数据错误" in result["message"]
        assert "users.email" in result["message"]
        assert "1 个脚本约束" in result["message"]
        assert "不计入违规" in result["message"]

    def test_skip_only_reports_pass_with_note(self, tmp_path, _mock_executor):
        """只有权限跳过、无真实违规 → 校验通过（0 违规），跳过以附注说明。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [_permission_skip_entry("check_a"), _permission_skip_entry("check_b")],
            "loading_errors": [],
            "duration_ms": 15,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))

        assert result["success"] is True
        assert result["details"]["error_count"] == 0
        assert result["details"]["has_errors"] is False
        assert result["details"]["skipped_scripted_count"] == 2
        assert "数据校验通过" in result["message"]
        assert "2 个脚本约束" in result["message"]
        assert "未计入违规" in result["message"]
        # 不得出现违规措辞
        assert "个数据错误" not in result["message"]

    def test_skip_keeps_loading_warning_priority(self, tmp_path, _mock_executor):
        """无违规、有加载警告且有权限跳过 → message 主体仍是加载警告，跳过附注补在后面。"""
        (tmp_path / "project.precis.yaml").write_text("version: 2\n")
        mock_instance = MagicMock()
        mock_instance.execute.return_value = {
            "errors": [_permission_skip_entry()],
            "loading_errors": [{"error_type": "SourceNotFound", "table": "orders", "message": "数据文件不存在"}],
            "duration_ms": 10,
        }
        _mock_executor.return_value = mock_instance

        result = execute_validate_project(str(tmp_path))

        assert result["details"]["error_count"] == 0
        assert "加载警告" in result["message"]
        assert "1 个脚本约束" in result["message"]
