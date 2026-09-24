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
"""
@fileoverview 项目探测 API 集成测试

覆盖 GET /api/latest/projects/check：
- 空目录 / 不存在的目录 / 已有项目目录 → 一律 200，用布尔字段表达（永不 404，
  前端智能打开探测不会在浏览器控制台留下红字）
- 相对路径 → 400
"""

from __future__ import annotations

import os

from fastapi.testclient import TestClient

from app.api.main import app


class TestCheckProject:
    """GET /api/latest/projects/check 行为测试"""

    def test_empty_dir_is_not_project(self, tmp_path):
        """空目录：200 + dir_exists=true + is_project=false（智能打开的引导场景）"""
        client = TestClient(app)
        empty_dir = str(tmp_path / "empty")
        os.makedirs(empty_dir)

        resp = client.get("/api/latest/projects/check", params={"path": empty_dir})
        assert resp.status_code == 200
        body = resp.json()
        assert body["dir_exists"] is True
        assert body["is_project"] is False
        assert body["path"] == empty_dir

    def test_project_dir_is_project(self, tmp_path):
        """含 manifest 的目录：200 + is_project=true"""
        client = TestClient(app)
        # 经正式创建端点生成合法项目脚手架
        proj_dir = str(tmp_path / "proj")
        create_resp = client.post(
            "/api/latest/projects/create",
            json={"path": proj_dir, "name": "Proj"},
        )
        assert create_resp.status_code == 200

        resp = client.get("/api/latest/projects/check", params={"path": proj_dir})
        assert resp.status_code == 200
        body = resp.json()
        assert body["dir_exists"] is True
        assert body["is_project"] is True

    def test_nonexistent_dir_reports_missing(self, tmp_path):
        """不存在的目录：仍 200（dir_exists=false），而非 404"""
        client = TestClient(app)
        missing = os.path.join(str(tmp_path), "no-such-dir")

        resp = client.get("/api/latest/projects/check", params={"path": missing})
        assert resp.status_code == 200
        body = resp.json()
        assert body["dir_exists"] is False
        assert body["is_project"] is False

    def test_relative_path_rejected(self):
        """相对路径：400（与 get_project_config_path 输入规则一致）"""
        client = TestClient(app)
        resp = client.get("/api/latest/projects/check", params={"path": "relative/dir"})
        assert resp.status_code == 400

    def test_missing_param_rejected(self):
        """缺 path 参数：422（FastAPI 查询参数校验）"""
        client = TestClient(app)
        resp = client.get("/api/latest/projects/check")
        assert resp.status_code == 422
