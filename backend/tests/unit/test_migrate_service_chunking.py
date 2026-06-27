"""@fileoverview 迁移服务按源分片单元测试

覆盖分片循环编排、合并、进度回调与 single 路径零回归。
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.generation import CancelledError


def _make_source(name: str, content: str, language: str = "python") -> dict:
    """构造来源字典。"""
    return {"name": name, "content": content, "language": language}


def _make_intent(name: str, intent: str, language: str = "python") -> dict:
    """构造解析后的意图字典。"""
    return {"name": name, "intent": intent, "language": language}


class TestMigrateServiceChunking:
    """迁移服务分片测试套件。"""

    @pytest.fixture
    def service(self):
        """构造测试用的迁移服务实例。"""
        return ConfigMigrationService(provider_id="fake")

    def _patch_run(self, service):
        """统一 mock 迁移服务依赖。"""
        service._setup_run = MagicMock()
        service._profile_files = AsyncMock(return_value=[])
        provider_mock = MagicMock()
        provider_mock.get_context_window = MagicMock(return_value=128000)
        service._get_provider = MagicMock(return_value=provider_mock)
        return provider_mock

    @pytest.mark.asyncio
    async def test_multi_source_calls_generate_per_chunk_and_merges(self, service):
        """多源按源分片后每分片独立生成并合并一次。"""
        self._patch_run(service)

        service._generate_config_for_scope = AsyncMock(
            side_effect=lambda **kwargs: {
                "schemas": {f"schema_{kwargs['instructions'].split()[0]}": {"columns": []}},
                "constraints": {},
            }
        )
        service._optional_refine_via_agent = AsyncMock(side_effect=lambda cfg, **kwargs: cfg)

        sources = [_make_source(f"src_{i}", f"print({i})") for i in range(6)]
        progress_records = []

        def progress(stage: str, progress: float, extra: dict | None = None):
            progress_records.append((stage, progress, extra or {}))

        with patch("app.shared.services.ai.migrate_service.MergeResultsTool") as merge_cls:
            merge_instance = MagicMock()
            merge_instance.run = MagicMock(
                return_value={
                    "success": True,
                    "config": {"schemas": {"merged_table": {"columns": []}}, "constraints": {}, "regex_nodes": {}},
                    "warnings": ["合并去重"],
                    "conflicts": [],
                }
            )
            merge_cls.return_value = merge_instance

            result = await service.migrate_from_script(
                script_content="",
                language="python",
                file_paths=["data/users.csv"],
                project_name="test",
                project_id="test",
                sources=sources,
                chunk_max_sources=2,
                chunk_max_tokens=8000,
                progress_callback=progress,
            )

        assert result["success"] is True
        # 6 个来源、每分片 2 个 -> 3 次生成
        assert service._generate_config_for_scope.call_count == 3
        # 合并调用一次
        assert merge_instance.run.call_count == 1
        # 多分片触发精修
        assert service._optional_refine_via_agent.call_count == 1
        # 进度包含 chunk 字段
        chunk_events = [r for r in progress_records if r[0] == "chunk_generate"]
        assert len(chunk_events) == 3
        for idx, (stage, progress, extra) in enumerate(chunk_events):
            assert extra["chunk_index"] == idx + 1
            assert extra["chunk_total"] == 3
        # 进度单调递增
        progresses = [r[1] for r in progress_records]
        assert progresses == sorted(progresses)

    @pytest.mark.asyncio
    async def test_single_source_zero_regression(self, service):
        """单来源退化为 single 分片并成功返回。"""
        self._patch_run(service)

        expected_config = {"schemas": {"users": {"columns": []}}, "constraints": {}}
        service._generate_config_for_scope = AsyncMock(return_value=expected_config)
        service._optional_refine_via_agent = AsyncMock(side_effect=lambda cfg, **kwargs: cfg)

        with patch("app.shared.services.ai.migrate_service.MergeResultsTool") as merge_cls:
            merge_instance = MagicMock()
            merge_instance.run = MagicMock(
                return_value={"success": True, "config": expected_config, "warnings": [], "conflicts": []}
            )
            merge_cls.return_value = merge_instance

            result = await service.migrate_from_script(
                script_content="print(1)",
                language="python",
                file_paths=["data/users.csv"],
                project_name="test",
                project_id="test",
                chunk_max_sources=5,
                chunk_max_tokens=8000,
            )

        assert result["success"] is True
        assert result["schemas"] == expected_config["schemas"]
        # single 分片只生成一次
        assert service._generate_config_for_scope.call_count == 1
        # single 分片不触发精修
        assert service._optional_refine_via_agent.call_count == 0

    @pytest.mark.asyncio
    async def test_progress_callback_includes_chunk_fields(self, service):
        """进度回调携带 chunk_index/chunk_total。"""
        self._patch_run(service)

        service._generate_config_for_scope = AsyncMock(return_value={"schemas": {}, "constraints": {}})
        service._optional_refine_via_agent = AsyncMock(side_effect=lambda cfg, **kwargs: cfg)

        sources = [_make_source(f"src_{i}", "x" * (100 + i)) for i in range(4)]
        progress_records = []

        def progress(stage: str, progress: float, extra: dict | None = None):
            progress_records.append((stage, progress, extra or {}))

        with patch("app.shared.services.ai.migrate_service.MergeResultsTool") as merge_cls:
            merge_instance = MagicMock()
            merge_instance.run = MagicMock(
                return_value={
                    "success": True,
                    "config": {"schemas": {}, "constraints": {}},
                    "warnings": [],
                    "conflicts": [],
                }
            )
            merge_cls.return_value = merge_instance

            await service.migrate_from_script(
                script_content="",
                language="python",
                file_paths=[],
                project_name="test",
                project_id="test",
                sources=sources,
                chunk_max_sources=2,
                chunk_max_tokens=8000,
                progress_callback=progress,
            )

        chunk_events = [r for r in progress_records if r[0] == "chunk_generate"]
        assert len(chunk_events) == 2
        assert chunk_events[0][2]["chunk_index"] == 1
        assert chunk_events[0][2]["chunk_total"] == 2
        assert chunk_events[1][2]["chunk_index"] == 2
        assert chunk_events[1][2]["chunk_total"] == 2

    @pytest.mark.asyncio
    async def test_cancel_during_chunk_generation(self, service):
        """分片生成阶段取消应抛出 CancelledError。"""
        self._patch_run(service)

        call_count = 0

        async def generate(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                service._cancelled = True
            return {"schemas": {f"t{call_count}": {"columns": []}}, "constraints": {}}

        service._generate_config_for_scope = generate
        service._optional_refine_via_agent = AsyncMock(side_effect=lambda cfg, **kwargs: cfg)

        sources = [_make_source(f"src_{i}", "x" * (100 + i)) for i in range(6)]

        with patch("app.shared.services.ai.migrate_service.MergeResultsTool") as merge_cls:
            merge_instance = MagicMock()
            merge_instance.run = MagicMock(
                return_value={
                    "success": True,
                    "config": {"schemas": {}, "constraints": {}},
                    "warnings": [],
                    "conflicts": [],
                }
            )
            merge_cls.return_value = merge_instance

            with pytest.raises(CancelledError):
                await service.migrate_from_script(
                    script_content="",
                    language="python",
                    file_paths=[],
                    project_name="test",
                    project_id="test",
                    sources=sources,
                    chunk_max_sources=2,
                    chunk_max_tokens=8000,
                )

        assert call_count == 2
