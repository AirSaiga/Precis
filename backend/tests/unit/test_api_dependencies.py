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
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

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


class TestNonAsciiHeaderPath:
    """HTTP header 携带的非 ASCII 路径还原（latin-1 乱码 → UTF-8）。

    背景：浏览器 XHR 按 UTF-8 上线 header 值，uvicorn/starlette 按 latin-1
    解码，中文路径变成乱码导致 isdir 失败、全部 API 404（GUI 无法打开任何
    非 ASCII 路径的项目；CLI 不走 header 不受影响）。
    """

    @pytest.mark.asyncio
    async def test_utf8_mojibake_chinese_path_recovers(self, tmp_path):
        """latin-1 乱码还原后指向真实中文目录，校验通过"""
        project_dir = tmp_path / "隔离测试"
        project_dir.mkdir()
        (project_dir / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        mojibake = str(project_dir).encode("utf-8").decode("latin-1")
        assert mojibake != str(project_dir)  # 确认构造出了乱码场景
        result = await get_project_config_path(mojibake)
        assert os.path.normpath(result) == os.path.normpath(str(project_dir))

    @pytest.mark.asyncio
    async def test_percent_encoded_gui_contract_recovers(self, tmp_path):
        """GUI 契约：前端 encodeURIComponent 上线（纯 ASCII），后端 unquote 还原"""
        project_dir = tmp_path / "隔离测试"
        project_dir.mkdir()
        (project_dir / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        from urllib.parse import quote

        encoded = quote(str(project_dir), safe="")
        result = await get_project_config_path(encoded)
        assert os.path.normpath(result) == os.path.normpath(str(project_dir))

    @pytest.mark.asyncio
    async def test_percent_encoded_unreserved_punct_recovers(self, tmp_path):
        """GUI 契约回归：encodeURIComponent 保留 !'()* 原样上线。

        JS encodeURIComponent 不转义 !'()*（Python quote(safe="") 会转义它们），
        round-trip 校验的 safe 集未对齐时，含括号/感叹号的中文项目路径契约 1
        判定必败 → 契约 2 原样放行百分号串 → 400/404。此处用 JS 忠实编码模拟
        （quote 补 !*'() 到 safe 集即与 encodeURIComponent 输出逐字符一致）。
        """
        project_dir = tmp_path / "项目(备份)!"
        project_dir.mkdir()
        (project_dir / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        from urllib.parse import quote

        encoded = quote(str(project_dir), safe="!*'()")
        assert "(" in encoded and ")" in encoded and "!" in encoded  # 确认构造出 JS 保留场景
        result = await get_project_config_path(encoded)
        assert os.path.normpath(result) == os.path.normpath(str(project_dir))

    def test_full_chain_unreserved_punct_header_via_testclient(self, tmp_path):
        """端到端（GUI 契约回归）：encodeURIComponent 保留 !'()* 的 header 经完整依赖链命中中文项目根"""
        from urllib.parse import quote

        project_dir = tmp_path / "项目(备份)!"
        project_dir.mkdir()
        (project_dir / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")

        app = FastAPI()

        @app.get("/ping")
        def ping(project_path: str = Depends(get_project_config_path)) -> dict:
            return {"path": project_path}

        client = TestClient(app)
        resp = client.get(
            "/ping",
            headers=[(b"X-Project-Config-Path", quote(str(project_dir), safe="!*'()").encode("ascii"))],
        )
        assert resp.status_code == 200
        assert os.path.normpath(resp.json()["path"]) == os.path.normpath(str(project_dir))

    @pytest.mark.asyncio
    async def test_literal_percent_path_not_misdecoded(self):
        """字面含 % 的合法路径不被误判为转义串（round-trip 校验不过 → 原值走 404）"""
        raw = os.path.abspath("D:\\100%25dir")
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path(raw)
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_ascii_path_passes_through_unchanged(self, tmp_path):
        """纯 ASCII 路径不受还原逻辑影响"""
        (tmp_path / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")
        result = await get_project_config_path(str(tmp_path))
        assert os.path.normpath(result) == os.path.normpath(str(tmp_path))

    @pytest.mark.asyncio
    async def test_non_utf8_bytes_kept_raw_then_rejected(self):
        """字节不是合法 UTF-8（如 latin-1 客户端）保持原值，走正常 404 校验链"""
        raw = os.path.abspath("D:\\café-project")  # é → latin-1 字节 0xE9，非合法 UTF-8
        raw.encode("latin-1")  # 可编码，确认进入还原尝试分支
        with pytest.raises(HTTPException) as exc_info:
            await get_project_config_path(raw)
        assert exc_info.value.status_code == 404
        assert isinstance(exc_info.value.detail, str)
        assert exc_info.value.detail.startswith("提供的项目配置路径不存在")

    def test_full_chain_utf8_header_bytes_via_testclient(self, tmp_path):
        """端到端（TUI/脚本契约）：以 UTF-8 原始字节注入 header，经完整依赖链命中中文项目根"""
        project_dir = tmp_path / "测试数据"
        project_dir.mkdir()
        (project_dir / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")

        app = FastAPI()

        @app.get("/ping")
        def ping(project_path: str = Depends(get_project_config_path)) -> dict:
            return {"path": project_path}

        client = TestClient(app)
        resp = client.get(
            "/ping",
            headers=[(b"X-Project-Config-Path", str(project_dir).encode("utf-8"))],
        )
        assert resp.status_code == 200
        assert os.path.normpath(resp.json()["path"]) == os.path.normpath(str(project_dir))

    def test_full_chain_percent_encoded_header_via_testclient(self, tmp_path):
        """端到端（GUI 契约）：encodeURIComponent 后的纯 ASCII header，经完整依赖链命中中文项目根"""
        from urllib.parse import quote

        project_dir = tmp_path / "测试数据"
        project_dir.mkdir()
        (project_dir / "project.precis.yaml").write_text("id: t\n", encoding="utf-8")

        app = FastAPI()

        @app.get("/ping")
        def ping(project_path: str = Depends(get_project_config_path)) -> dict:
            return {"path": project_path}

        client = TestClient(app)
        resp = client.get(
            "/ping",
            headers=[(b"X-Project-Config-Path", quote(str(project_dir), safe="").encode("ascii"))],
        )
        assert resp.status_code == 200
        assert os.path.normpath(resp.json()["path"]) == os.path.normpath(str(project_dir))
