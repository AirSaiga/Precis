"""@fileoverview AI 配置迁移服务单元测试

覆盖迁移来源去重、取消响应等逻辑。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.generation import CancelledError


class TestConfigMigrationService:
    """配置迁移服务测试套件。"""

    @pytest.fixture
    def service(self):
        """构造测试用的迁移服务实例。"""
        return ConfigMigrationService(provider_id="fake")

    @pytest.mark.asyncio
    async def test_migrate_sources_deduplicated(self, service):
        """重复的脚本内容只解析一次。"""
        service._setup_run = MagicMock()
        service._profile_files = AsyncMock(return_value={})
        provider_mock = MagicMock()
        provider_mock.get_context_window = MagicMock(return_value=128000)
        service._get_provider = MagicMock(return_value=provider_mock)
        service._create_migrate_registry = MagicMock()
        service._build_migrate_system_prompt = MagicMock(return_value="")
        service._build_migrate_task_message = MagicMock(return_value="")
        service._format_profiling_for_agent = MagicMock(return_value="")
        service._generate_config_for_scope = AsyncMock(return_value={"schemas": {"users": {}}, "constraints": {}})
        service._optional_refine_via_agent = AsyncMock(side_effect=lambda cfg, **kwargs: cfg)

        with patch("app.shared.services.ai.migrate_service.MergeResultsTool") as merge_cls:
            merge_instance = MagicMock()
            merge_instance.run = MagicMock(
                return_value={
                    "success": True,
                    "config": {"schemas": {"users": {}}, "constraints": {}},
                    "warnings": [],
                    "conflicts": [],
                }
            )
            merge_cls.return_value = merge_instance

            result = await service.migrate_from_script(
                script_content="print(1)",
                language="python",
                file_paths=[],
                project_name="test",
                project_id="test",
                sources=[
                    {"content": "print(1)", "language": "python", "name": "a.py"},
                    {"content": "print(1)", "language": "python", "name": "b.py"},
                    {"content": "print(2)", "language": "python", "name": "c.py"},
                ],
            )

        assert result["success"] is True
        # 两个不同内容的来源：print(1) 和 print(2)
        # 默认启用分片，single 分片只调用一次生成
        assert service._generate_config_for_scope.call_count == 1
        instructions = service._generate_config_for_scope.call_args.kwargs["instructions"]
        assert "a.py" in instructions
        assert "c.py" in instructions
        assert "b.py" not in instructions

    @pytest.mark.asyncio
    async def test_migrate_respects_cancel_during_parse(self, service):
        """解析循环中检测到取消应抛出 CancelledError。"""
        service._setup_run = MagicMock()
        service._profile_files = AsyncMock(return_value={})
        service._cancelled = True

        with pytest.raises(CancelledError):
            await service.migrate_from_script(
                script_content="print(1)",
                language="python",
                file_paths=[],
                project_name="test",
                project_id="test",
                sources=[{"content": "print(1)", "language": "python", "name": "a.py"}],
            )

    @pytest.mark.asyncio
    async def test_migrate_returns_failure_when_no_sources(self, service):
        """未提供任何脚本来源时返回失败。"""
        service._setup_run = MagicMock()
        service._profile_files = AsyncMock(return_value={})

        result = await service.migrate_from_script(
            script_content="",
            language="python",
            file_paths=[],
            project_name="test",
            project_id="test",
            sources=[],
        )

        assert result["success"] is False
        assert "未提供" in result["error"] or "脚本" in result["error"]
