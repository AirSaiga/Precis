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
    async def test_valid_project_root(self, tmp_path):
        """合法项目根（含 manifest）通过"""
        (tmp_path / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        path = str(tmp_path)
        result = await get_project_config_path(path)
        assert os.path.isabs(result)
        assert os.path.normpath(result) == os.path.normpath(path)

    @pytest.mark.asyncio
    async def test_nonexistent_path_raises_404(self):
        # 使用 os.path.abspath 构造一个当前平台下一定不存在的绝对路径
        nonexistent_abs = os.path.abspath("/nonexistent/path/12345")
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path(nonexistent_abs)
        assert exc_info.value.status_code == 404
        assert "不存在" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_relative_path_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path("relative/path/to/project")
        assert exc_info.value.status_code == 400
        assert "必须是一个绝对路径" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_missing_manifest_raises_404_structured(self, tmp_path):
        """§2.1: 目录存在但无 manifest → 404 + 结构化错误码（原 400 与 GET /manifest
        端点对同一情形不同状态码，且前端 404 自愈链永不触发）"""
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path(str(tmp_path))
        assert exc_info.value.status_code == 404
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "PROJECT_NOT_FOUND"
        assert "project.precis.yaml" in detail["message"]
        assert os.path.normpath(detail["path"]) == os.path.normpath(str(tmp_path))

    @pytest.mark.asyncio
    async def test_nonexistent_path_keeps_string_detail(self):
        """§2.1 对照：目录不存在出口保留字符串 detail（前端字符串前缀分支兼容旧轨）"""
        nonexistent_abs = os.path.abspath("/nonexistent/path/12345")
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path(nonexistent_abs)
        assert exc_info.value.status_code == 404
        assert isinstance(exc_info.value.detail, str)
        assert exc_info.value.detail.startswith("提供的项目配置路径不存在")

    @pytest.mark.asyncio
    async def test_path_traversal_dotdot_rejected(self, tmp_path):
        """B-sec3: 含 `..` 的路径被拒（即使 normpath 后仍指向有效目录）"""
        base = tmp_path / "project"
        base.mkdir()
        (base / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        (base / "config").mkdir()
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path(str(base / "config" / ".." / "config"))
        # 2.1: normpath 消解后该路径指向有效目录（无 manifest），落入
        # manifest 缺失分支 → 404 结构化（原该分支为 400）
        assert exc_info.value.status_code == 404
        assert isinstance(exc_info.value.detail, dict)
        assert exc_info.value.detail["code"] == "PROJECT_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_empty_path_raises_400(self):
        """B-sec3: 空路径被拒"""
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path("")
        assert exc_info.value.status_code == 400


class TestGetProjectStore:
    @pytest.mark.asyncio
    async def test_returns_project_store(self, tmp_path):
        """B-sec3: 需合法项目根（含 manifest）"""
        (tmp_path / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        result = await get_project_store(str(tmp_path))
        assert isinstance(result, ProjectStore)
        assert os.path.normpath(result.project_path) == os.path.normpath(str(tmp_path))
