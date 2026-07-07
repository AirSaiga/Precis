"""@fileoverview TUI 配置生成/迁移服务单元测试

覆盖范围:
- generate（Agent 模式 + 单次模式）正确转发到 ConfigGenerationService，并透传进度回调
- migrate 正确转发到 ConfigMigrationService
- apply_result 调真实 generation_ops.apply_generated_config 完成写盘
- scan_data_files 透传委托

mock 边界：ConfigGenerationService / ConfigMigrationService 的实例方法（AsyncMock）。
不 mock generation_ops（写盘是真实 IO，用 tmp_path 验证文件落地）。
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# 将 backend/ 加入 sys.path，使 app 包可被直接导入（与其它后端测试保持一致）
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.cli.tui.services.generation_service import (  # noqa: E402
    GenerationService,
    ProgressCallback,
)


@pytest.fixture
def sample_result() -> dict:
    """构造一个生成成功的结果字典（含 manifest/schemas/constraints）。"""
    return {
        "success": True,
        "yaml_preview": "version: 2\nproject:\n  id: demo\n  name: Demo",
        "manifest": {
            "version": 2,
            "project": {"id": "demo", "name": "Demo"},
            "schemas": [],
            "constraints": [],
            "regex_nodes": [],
        },
        "schemas": {"users": {"version": 2, "id": "users", "name": "users"}},
        "constraints": {"c1": {"id": "c1", "type": "not_null"}},
        "regex_nodes": {},
        "warnings": [],
    }


class TestGenerationServiceGenerate:
    """generate 方法的转发与回调测试。"""

    @pytest.mark.asyncio
    @patch("app.cli.tui.services.generation_service.ConfigGenerationService")
    async def test_generate_agent_mode_calls_generate_with_agent(self, mock_cls, sample_result):
        """agent_mode=True 应调用 generate_with_agent 并透传参数。"""
        mock_instance = MagicMock()
        mock_instance.generate_with_agent = AsyncMock(return_value=sample_result)
        mock_cls.return_value = mock_instance

        svc = GenerationService()
        captured: list[tuple[str, float, dict | None]] = []

        def on_progress(stage: str, progress: float, extra: dict | None = None) -> None:
            captured.append((stage, progress, extra))

        result = await svc.generate(
            file_paths=["/proj/data/users.xlsx"],
            project_name="Demo",
            project_id="demo",
            config_path="/proj",
            agent_mode=True,
            max_iterations=3,
            sample_rows=50,
            sample_values_per_column=20,
            generate_regex=True,
            on_progress=on_progress,
        )

        assert result is sample_result
        mock_instance.generate_with_agent.assert_awaited_once()
        mock_instance.generate.assert_not_called()

        # 校验关键参数透传
        call_kwargs = mock_instance.generate_with_agent.call_args.kwargs
        assert call_kwargs["project_name"] == "Demo"
        assert call_kwargs["project_id"] == "demo"
        assert call_kwargs["config_path"] == "/proj"
        assert call_kwargs["max_iterations"] == 3
        assert call_kwargs["file_paths"] == ["/proj/data/users.xlsx"]
        # 进度回调透传
        assert call_kwargs["progress_callback"] is on_progress
        # ProfilingOptions 采样行数
        assert call_kwargs["profiling_options"].sample_rows == 50
        assert call_kwargs["profiling_options"].sample_values_per_column == 20
        # GenerationOptions 正则开关
        assert call_kwargs["generation_options"].generate_regex_nodes is True
        assert call_kwargs["generation_options"].generate_schemas is True

    @pytest.mark.asyncio
    @patch("app.cli.tui.services.generation_service.ConfigGenerationService")
    async def test_generate_single_mode_calls_generate(self, mock_cls, sample_result):
        """agent_mode=False 应调用单次 generate，并把三参回调适配为两参。"""
        mock_instance = MagicMock()
        mock_instance.generate = AsyncMock(return_value=sample_result)
        mock_cls.return_value = mock_instance

        svc = GenerationService()
        captured: list[tuple[str, float, dict | None]] = []

        def on_progress(stage: str, progress: float, extra: dict | None = None) -> None:
            captured.append((stage, progress, extra))

        result = await svc.generate(
            file_paths=["/proj/data/users.xlsx"],
            project_name="Demo",
            project_id="demo",
            agent_mode=False,
            on_progress=on_progress,
        )

        assert result is sample_result
        mock_instance.generate.assert_awaited_once()
        mock_instance.generate_with_agent.assert_not_called()

        call_kwargs = mock_instance.generate.call_args.kwargs
        # 单次模式透传的 progress_callback 是适配器（非 None）
        assert call_kwargs["progress_callback"] is not None
        assert call_kwargs["profiling_options"].sample_rows == 100  # 默认值

    @pytest.mark.asyncio
    @patch("app.cli.tui.services.generation_service.ConfigGenerationService")
    async def test_generate_single_mode_progress_adapter_invokes_callback(self, mock_cls, sample_result):
        """单次模式的适配器被底层调用时，应触发三参 on_progress（extra=None）。"""
        mock_instance = MagicMock()
        mock_instance.generate = AsyncMock(return_value=sample_result)
        mock_cls.return_value = mock_instance

        svc = GenerationService()
        captured: list[tuple[str, float, dict | None]] = []

        def on_progress(stage: str, progress: float, extra: dict | None = None) -> None:
            captured.append((stage, progress, extra))

        await svc.generate(
            file_paths=["/p/users.xlsx"],
            project_name="D",
            project_id="d",
            agent_mode=False,
            on_progress=on_progress,
        )

        # 取出透传给底层 generate 的适配器并手动调用，验证三参回调被触发
        adapter = mock_instance.generate.call_args.kwargs["progress_callback"]
        adapter("profiling", 10.0)
        assert captured[-1] == ("profiling", 10.0, None)

    @pytest.mark.asyncio
    @patch("app.cli.tui.services.generation_service.ConfigGenerationService")
    async def test_generate_no_progress_callback_passes_none(self, mock_cls, sample_result):
        """未提供 on_progress 时，单次模式应传 None 给底层。"""
        mock_instance = MagicMock()
        mock_instance.generate = AsyncMock(return_value=sample_result)
        mock_cls.return_value = mock_instance

        svc = GenerationService()
        await svc.generate(
            file_paths=["/p/users.xlsx"],
            project_name="D",
            project_id="d",
            agent_mode=False,
        )

        assert mock_instance.generate.call_args.kwargs["progress_callback"] is None

    @pytest.mark.asyncio
    @patch("app.cli.tui.services.generation_service.ConfigGenerationService")
    async def test_generate_agent_mode_no_progress_passes_none(self, mock_cls, sample_result):
        """agent 模式未提供 on_progress 时透传 None。"""
        mock_instance = MagicMock()
        mock_instance.generate_with_agent = AsyncMock(return_value=sample_result)
        mock_cls.return_value = mock_instance

        svc = GenerationService()
        await svc.generate(
            file_paths=["/p/users.xlsx"],
            project_name="D",
            project_id="d",
            agent_mode=True,
        )

        assert mock_instance.generate_with_agent.call_args.kwargs["progress_callback"] is None


class TestGenerationServiceMigrate:
    """migrate 方法的转发测试。"""

    @pytest.mark.asyncio
    @patch("app.cli.tui.services.generation_service.ConfigMigrationService")
    async def test_migrate_calls_migrate_from_script(self, mock_cls, sample_result):
        """migrate 应转发到 ConfigMigrationService.migrate_from_script。"""
        mock_instance = MagicMock()
        mock_instance.migrate_from_script = AsyncMock(return_value=sample_result)
        mock_cls.return_value = mock_instance

        svc = GenerationService()

        def on_progress(stage: str, progress: float, extra: dict | None = None) -> None:
            pass

        result = await svc.migrate(
            script_content="df.dropna()",
            language="python",
            file_paths=["/proj/data/users.xlsx"],
            project_name="Demo",
            project_id="demo",
            config_path="/proj",
            max_iterations=4,
            sample_rows=200,
            on_progress=on_progress,
        )

        assert result is sample_result
        mock_instance.migrate_from_script.assert_awaited_once()
        call_kwargs = mock_instance.migrate_from_script.call_args.kwargs
        assert call_kwargs["script_content"] == "df.dropna()"
        assert call_kwargs["language"] == "python"
        assert call_kwargs["project_name"] == "Demo"
        assert call_kwargs["config_path"] == "/proj"
        assert call_kwargs["max_iterations"] == 4
        assert call_kwargs["progress_callback"] is on_progress
        # 迁移强制不生成 regex 节点
        assert call_kwargs["generation_options"].generate_regex_nodes is False
        assert call_kwargs["profiling_options"].sample_rows == 200


class TestGenerationServiceApplyResult:
    """apply_result 写盘测试——调真实 generation_ops.apply_generated_config。"""

    def test_apply_result_writes_files(self, tmp_path, sample_result):
        """apply_result 应把 manifest/schemas/constraints 写入项目目录。"""
        svc = GenerationService()
        written = svc.apply_result(sample_result, str(tmp_path))

        assert "project.precis.yaml" in written
        assert "schemas/users.schema.yaml" in written
        assert "constraints/c1.constraint.yaml" in written
        # 文件实际落地
        assert (tmp_path / "project.precis.yaml").exists()
        assert (tmp_path / "schemas" / "users.schema.yaml").exists()
        assert (tmp_path / "constraints" / "c1.constraint.yaml").exists()

    def test_apply_result_preserves_existing_transforms(self, tmp_path):
        """apply_result 写盘应保留现有 manifest 的 transforms/manual_data 引用。

        覆盖 generation_ops.apply_generated_config 的保留逻辑（P0b 契约）。
        """
        # 先写入一个带 transforms 的 manifest
        existing_manifest = tmp_path / "project.precis.yaml"
        existing_manifest.write_text(
            "version: 2\nproject:\n  id: demo\n  name: Demo\ntransforms:\n  - id: t1\n    path: transforms/t1.transform.yaml\n",
            encoding="utf-8",
        )

        svc = GenerationService()
        result = {
            "success": True,
            "manifest": {
                "version": 2,
                "project": {"id": "demo", "name": "Demo"},
            },
            "schemas": {"s1": {"id": "s1"}},
            "constraints": {},
            "regex_nodes": {},
        }
        svc.apply_result(result, str(tmp_path))

        # 读回 manifest，transforms 应被保留
        import yaml

        with open(existing_manifest, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert "transforms" in data
        assert data["transforms"][0]["id"] == "t1"


class TestGenerationServiceScanDataFiles:
    """scan_data_files 透传委托测试。"""

    def test_scan_data_files_scans_data_dir(self, tmp_path):
        """scan_data_files 应委托 generation_ops 扫描 data/ 目录。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "a.xlsx").write_text("x")
        (data_dir / "b.txt").write_text("y")

        svc = GenerationService()
        files = svc.scan_data_files([], str(tmp_path))

        assert any("a.xlsx" in f for f in files)
        assert not any("b.txt" in f for f in files)

    def test_scan_data_files_with_patterns(self, tmp_path):
        """显式 patterns 应被展开。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        (data_dir / "users.csv").write_text("x")

        svc = GenerationService()
        files = svc.scan_data_files(["data/users.csv"], str(tmp_path))
        assert any("users.csv" in f for f in files)


class TestProgressCallbackType:
    """ProgressCallback 类型别名可导入（仅类型检查用，不实例化）。"""

    def test_progress_callback_alias_importable(self):
        """ProgressCallback 应可从 service 模块导入。"""
        assert ProgressCallback is not None
