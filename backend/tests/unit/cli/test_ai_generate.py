"""测试 CLI AI 配置生成命令"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.cli.shell.commands.ai.generate import AIGenerateCommand, _scan_data_files
from app.cli.shell.commands.base import ProjectContext


@pytest.fixture
def project_context(tmp_path):
    """构造一个已打开项目的 ProjectContext。"""
    ctx = ProjectContext()
    ctx.project_path = str(tmp_path)
    ctx.project_config = {"project": {"name": "TestProject", "id": "test-project"}}
    return ctx


class TestAIGenerateCommand:
    def test_requires_project_open(self):
        """未打开项目时返回错误。"""
        cmd = AIGenerateCommand()
        ctx = ProjectContext()
        result = cmd.execute([], ctx)
        assert not result.success
        assert "未打开项目" in result.message

    def test_no_supported_files_returns_error(self, project_context):
        """data/ 目录为空时返回错误。"""
        cmd = AIGenerateCommand()
        result = cmd.execute([], project_context)
        assert not result.success
        assert "数据文件" in result.message

    def test_unknown_arg_returns_error(self, project_context, tmp_path):
        """未知参数返回错误。"""
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "users.xlsx").write_text("fake")
        cmd = AIGenerateCommand()
        result = cmd.execute(["--unknown"], project_context)
        assert not result.success
        assert "未知参数" in result.message

    @patch("app.cli.shell.commands.ai.generate.ConfigGenerationService")
    def test_generate_preview_success(self, mock_service_cls, project_context, tmp_path):
        """默认生成 YAML 预览，不写盘。"""
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.generate_with_agent = AsyncMock(
            return_value={
                "success": True,
                "yaml_preview": "version: 2\nproject:\n  id: test-project",
                "schemas": {"users": {"id": "users"}},
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIGenerateCommand()
        result = cmd.execute([], project_context)

        assert result.success
        assert "预览" in result.message
        mock_service.generate_with_agent.assert_awaited_once()

        # 未写盘
        assert not (tmp_path / "project.precis.yaml").exists()

    @patch("app.cli.shell.commands.ai.generate.ConfigGenerationService")
    def test_generate_apply_writes_files(self, mock_service_cls, project_context, tmp_path):
        """加 --apply 后写盘。"""
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.generate_with_agent = AsyncMock(
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
                "constraints": {},
                "regex_nodes": {},
                "warnings": [],
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIGenerateCommand()
        result = cmd.execute(["--apply"], project_context)

        assert result.success
        assert "写入项目" in result.message
        assert (tmp_path / "project.precis.yaml").exists()
        assert (tmp_path / "schemas" / "users.schema.yaml").exists()

    @patch("app.cli.shell.commands.ai.generate.ConfigGenerationService")
    def test_generate_failure_returns_error(self, mock_service_cls, project_context, tmp_path):
        """生成失败时返回错误。"""
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.generate_with_agent = AsyncMock(
            return_value={
                "success": False,
                "error": "AI 解析失败",
            }
        )
        mock_service_cls.return_value = mock_service

        cmd = AIGenerateCommand()
        result = cmd.execute([], project_context)

        assert not result.success
        assert "AI 解析失败" in result.message

    @patch("app.cli.shell.commands.ai.generate.ConfigGenerationService")
    def test_no_agent_mode_uses_single_shot(self, mock_service_cls, project_context, tmp_path):
        """--no-agent-mode 调用单次 generate。"""
        (tmp_path / "data").mkdir()
        (tmp_path / "data" / "users.xlsx").write_text("fake")

        mock_service = MagicMock()
        mock_service.generate = AsyncMock(
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

        cmd = AIGenerateCommand()
        result = cmd.execute(["--no-agent-mode"], project_context)

        assert result.success
        mock_service.generate.assert_awaited_once()
        mock_service.generate_with_agent.assert_not_called()


class TestScanDataFiles:
    def test_scan_data_directory(self, tmp_path):
        """扫描 data/ 目录返回支持的文件。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "users.xlsx").write_text("fake")
        (data_dir / "orders.csv").write_text("fake")
        (data_dir / "readme.txt").write_text("ignore")

        files = _scan_data_files(str(tmp_path))
        assert len(files) == 2
        assert all(str(data_dir) in f for f in files)

    def test_scan_missing_data_directory(self, tmp_path):
        """data/ 目录不存在返回空列表。"""
        assert _scan_data_files(str(tmp_path)) == []
