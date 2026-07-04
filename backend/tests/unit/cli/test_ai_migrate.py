"""测试 CLI AI 配置迁移命令"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.cli.shell.commands.ai.migrate import AIMigrateCommand, _infer_language
from app.cli.shell.commands.base import ProjectContext


@pytest.fixture
def project_context(tmp_path):
    """构造一个已打开项目的 ProjectContext。"""
    ctx = ProjectContext()
    ctx.project_path = str(tmp_path)
    ctx.project_config = {"project": {"name": "TestProject", "id": "test-project"}}
    return ctx


class TestAIMigrateCommand:
    def test_requires_project_open(self):
        """未打开项目时返回错误。"""
        cmd = AIMigrateCommand()
        ctx = ProjectContext()
        result = cmd.execute(["rules.py"], ctx)
        assert not result.success
        assert "未打开项目" in result.message

    def test_requires_script_file(self, project_context):
        """脚本文件不存在返回错误。"""
        cmd = AIMigrateCommand()
        result = cmd.execute(["rules.py", "data/users.xlsx"], project_context)
        assert not result.success
        assert "脚本文件不存在" in result.message

    def test_requires_data_files(self, project_context, tmp_path):
        """缺少数据文件返回错误。"""
        script = tmp_path / "rules.py"
        script.write_text("# rules")
        cmd = AIMigrateCommand()
        result = cmd.execute(["rules.py"], project_context)
        assert not result.success
        assert "数据文件" in result.message

    @patch("app.cli.shell.commands.ai.migrate.ConfigMigrationService")
    def test_migrate_preview_success(self, mock_service_cls, project_context, tmp_path):
        """默认生成 YAML 预览，不写盘。"""
        script = tmp_path / "rules.py"
        script.write_text("# pandas rules")
        data = tmp_path / "data"
        data.mkdir()
        (data / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.migrate_from_script = AsyncMock(
            return_value={
                "success": True,
                "yaml_preview": "version: 2\nproject:\n  id: test-project",
                "schemas": {},
                "constraints": {"users_email_unique": {"type": "Unique"}},
                "regex_nodes": {},
                "warnings": [],
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIMigrateCommand()
        result = cmd.execute(["rules.py", "data/users.xlsx"], project_context)

        assert result.success
        assert "预览" in result.message
        mock_service.migrate_from_script.assert_awaited_once()

        # 验证传入了推断的语言
        call_kwargs = mock_service.migrate_from_script.call_args.kwargs
        assert call_kwargs["language"] == "python"
        assert not (tmp_path / "project.precis.yaml").exists()

    @patch("app.cli.shell.commands.ai.migrate.ConfigMigrationService")
    def test_migrate_apply_writes_files(self, mock_service_cls, project_context, tmp_path):
        """加 --apply 后写盘。"""
        script = tmp_path / "rules.sql"
        script.write_text("SELECT * FROM users")
        data = tmp_path / "data"
        data.mkdir()
        (data / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.migrate_from_script = AsyncMock(
            return_value={
                "success": True,
                "yaml_preview": "",
                "manifest": {
                    "version": 2,
                    "project": {"id": "test-project", "name": "TestProject"},
                    "schemas": [],
                    "constraints": [],
                    "regex_nodes": [],
                },
                "schemas": {"users": {"version": 2, "id": "users", "name": "users"}},
                "constraints": {
                    "users_email_unique": {
                        "version": 2,
                        "id": "users_email_unique",
                        "type": "Unique",
                    }
                },
                "regex_nodes": {},
                "warnings": [],
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIMigrateCommand()
        result = cmd.execute(["rules.sql", "data/users.xlsx", "--apply"], project_context)

        assert result.success
        assert "写入项目" in result.message
        assert (tmp_path / "project.precis.yaml").exists()
        assert (tmp_path / "schemas" / "users.schema.yaml").exists()
        assert (tmp_path / "constraints" / "users_email_unique.constraint.yaml").exists()

    @patch("app.cli.shell.commands.ai.migrate.ConfigMigrationService")
    def test_migrate_failure_returns_error(self, mock_service_cls, project_context, tmp_path):
        """迁移失败返回错误。"""
        script = tmp_path / "rules.py"
        script.write_text("# rules")
        data = tmp_path / "data"
        data.mkdir()
        (data / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.migrate_from_script = AsyncMock(
            return_value={
                "success": False,
                "error": "无法解析脚本",
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIMigrateCommand()
        result = cmd.execute(["rules.py", "data/users.xlsx"], project_context)

        assert not result.success
        assert "无法解析脚本" in result.message

    @patch("app.cli.shell.commands.ai.migrate.ConfigMigrationService")
    def test_language_override(self, mock_service_cls, project_context, tmp_path):
        """--language 覆盖自动推断。"""
        script = tmp_path / "rules.txt"
        script.write_text("some rules")
        data = tmp_path / "data"
        data.mkdir()
        (data / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.migrate_from_script = AsyncMock(
            return_value={
                "success": True,
                "yaml_preview": "version: 2",
                "schemas": {},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIMigrateCommand()
        result = cmd.execute(
            ["rules.txt", "data/users.xlsx", "--language", "natural_language"],
            project_context,
        )

        assert result.success
        call_kwargs = mock_service.migrate_from_script.call_args.kwargs
        assert call_kwargs["language"] == "natural_language"


class TestInferLanguage:
    def test_python(self):
        assert _infer_language("/path/rules.py") == "python"

    def test_sql(self):
        assert _infer_language("/path/rules.sql") == "sql"

    def test_excel_formula(self):
        assert _infer_language("sheet.xlsx") == "excel_formula"
        assert _infer_language("sheet.xls") == "excel_formula"
        assert _infer_language("sheet.csv") == "excel_formula"

    def test_natural_language_fallback(self):
        assert _infer_language("rules.md") == "natural_language"
        assert _infer_language("rules.txt") == "natural_language"
