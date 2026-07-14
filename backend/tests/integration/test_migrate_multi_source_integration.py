"""@fileoverview 迁移服务多源分片集成测试

3 个 Python 来源（不同表/列）+ mock provider + 临时数据文件 → 端到端 result.success=True，
验证分片生成、合并去重、SSE 进度携带 chunk_index/chunk_total。
"""

from __future__ import annotations

import os
import re
import tempfile
from collections.abc import AsyncIterator
from unittest.mock import MagicMock

import pytest

from app.shared.services.ai.migrate_service import ConfigMigrationService
from app.shared.services.llm.providers.base import ChatResponse, StreamChunk


def _make_provider_mock() -> MagicMock:
    """构造按分片返回不同 schema 的 mock provider。"""
    provider = MagicMock()
    provider.get_context_window = MagicMock(return_value=128000)

    def build_content(req):
        content = ""
        for m in req.messages:
            text = m.content or ""
            # 分片生成指令
            match = re.search(r"这是第 (\d+)/(\d+) 个分片", text)
            if match:
                idx = int(match.group(1))
                table_name = f"table_{idx}"
                col_name = f"col_{idx}"
                content = (
                    f'{{"schemas": [{{"id": "{table_name}", "name": "{table_name}", '
                    f'"columns": [{{"name": "{col_name}"}}]}}], '
                    f'"constraints": [], "regex_nodes": []}}'
                )
                break
            # 精修阶段：直接返回合并后配置
            if "以下配置由多个来源分片分别生成后合并而来" in text:
                content = (
                    '{"schemas": [{"id": "table_1", "name": "table_1", "columns": [{"name": "col_1"}]}, '
                    '{"id": "table_2", "name": "table_2", "columns": [{"name": "col_2"}]}, '
                    '{"id": "table_3", "name": "table_3", "columns": [{"name": "col_3"}]}], '
                    '"constraints": [], "regex_nodes": []}'
                )
                break

        if not content:
            content = '{"schemas": [], "constraints": []}'
        return content

    async def chat(req):
        return ChatResponse(content=build_content(req))

    async def chat_stream(req) -> AsyncIterator[StreamChunk]:
        content = build_content(req)
        if content:
            yield StreamChunk(type="delta", text=content)

    provider.chat = chat
    provider.chat_stream = chat_stream
    return provider


class TestMigrateMultiSourceIntegration:
    """多源迁移集成测试。"""

    @pytest.fixture
    def service(self):
        """构造带 mock provider 的迁移服务。"""
        svc = ConfigMigrationService(provider_id="fake")
        provider = _make_provider_mock()
        svc._provider = provider
        return svc

    @pytest.fixture
    def temp_csv_files(self):
        """创建 3 个临时 CSV 数据文件。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            paths = []
            for i in range(1, 4):
                path = os.path.join(tmpdir, f"table_{i}.csv")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(f"col_{i}\n{i}\n")
                paths.append(path)
            yield paths

    @pytest.mark.asyncio
    async def test_three_sources_end_to_end_success(self, service, temp_csv_files):
        """3 个不同来源端到端生成成功且无重复表。"""
        sources = [
            {"name": "source_a", "content": "df['table_1']['col_1'].notnull()", "language": "python"},
            {"name": "source_b", "content": "df['table_2']['col_2'].notnull()", "language": "python"},
            {"name": "source_c", "content": "df['table_3']['col_3'].notnull()", "language": "python"},
        ]

        result = await service.migrate_from_script(
            script_content="",
            language="python",
            file_paths=temp_csv_files,
            project_name="integration_test",
            project_id="integration_test",
            sources=sources,
            chunk_max_sources=1,
            chunk_max_tokens=8000,
            max_iterations=1,
        )

        assert result["success"] is True
        schemas = result.get("schemas", {})
        assert set(schemas.keys()) == {"table_1", "table_2", "table_3"}
        for i in range(1, 4):
            assert schemas[f"table_{i}"]["columns"][0]["name"] == f"col_{i}"

    @pytest.mark.asyncio
    async def test_progress_emits_chunk_fields(self, service, temp_csv_files):
        """进度回调出现 chunk_index/chunk_total。"""
        sources = [
            {"name": "source_a", "content": "df['table_1']['col_1'].notnull()", "language": "python"},
            {"name": "source_b", "content": "df['table_2']['col_2'].notnull()", "language": "python"},
            {"name": "source_c", "content": "df['table_3']['col_3'].notnull()", "language": "python"},
        ]
        progress_records = []

        def progress(stage: str, progress: float, extra: dict | None = None):
            progress_records.append((stage, progress, extra or {}))

        await service.migrate_from_script(
            script_content="",
            language="python",
            file_paths=temp_csv_files,
            project_name="integration_test",
            project_id="integration_test",
            sources=sources,
            chunk_max_sources=1,
            chunk_max_tokens=8000,
            max_iterations=1,
            progress_callback=progress,
        )

        chunk_events = [r for r in progress_records if r[0] == "chunk_generate"]
        assert len(chunk_events) == 3
        indices = sorted(r[2]["chunk_index"] for r in chunk_events)
        totals = {r[2]["chunk_total"] for r in chunk_events}
        assert indices == [1, 2, 3]
        assert totals == {3}
