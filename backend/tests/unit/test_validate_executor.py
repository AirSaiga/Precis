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
