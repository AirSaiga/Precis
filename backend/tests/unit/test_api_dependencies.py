"""测试 API 依赖注入模块"""

from __future__ import annotations

import os

import pytest
from fastapi import HTTPException

from app.api.dependencies import ProjectStore, get_project_config_path, get_project_store


class TestProjectStore:
    def test_init(self):
        store = ProjectStore("/path/to/project")
        assert store.project_path == "/path/to/project"

    def test_attribute_access(self):
        store = ProjectStore("/tmp")
        assert store.project_path == "/tmp"


class TestGetProjectConfigPath:
    @pytest.mark.asyncio
    async def test_valid_absolute_path(self, tmp_path):
        path = str(tmp_path)
        result = await get_project_config_path(path)
        assert os.path.isabs(result)
        assert os.path.normpath(result) == os.path.normpath(path)

    @pytest.mark.asyncio
    async def test_nonexistent_path_raises_404(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path("/nonexistent/path/12345")
        assert exc_info.value.status_code == 404
        assert "不存在" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_path_traversal_normalization(self, tmp_path):
        base = tmp_path / "project"
        base.mkdir()
        (base / "config").mkdir()
        result = await get_project_config_path(str(base / "config" / ".." / "config"))
        assert os.path.normpath(result) == os.path.normpath(str(base / "config"))


class TestGetProjectStore:
    @pytest.mark.asyncio
    async def test_returns_project_store(self, tmp_path):
        result = await get_project_store(str(tmp_path))
        assert isinstance(result, ProjectStore)
        assert os.path.normpath(result.project_path) == os.path.normpath(str(tmp_path))
