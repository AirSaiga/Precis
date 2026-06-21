"""
@fileoverview Web 端新建项目 API 集成测试

覆盖 POST /api/latest/projects/create：
- 创建项目脚手架（目录 + manifest + 子目录）
- 拒绝已存在的项目（manifest 已存在时返回 400）
"""

from __future__ import annotations

import os

import yaml
from fastapi.testclient import TestClient

from app.api.main import app


class TestCreateProject:
    """POST /api/latest/projects/create 行为测试"""

    def test_create_project_writes_scaffold(self, tmp_path):
        client = TestClient(app)
        proj_dir = str(tmp_path / "newproj")
        resp = client.post(
            "/api/latest/projects/create",
            json={"path": proj_dir, "name": "NewProj"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["name"] == "NewProj"
        assert body["path"] == proj_dir

        # manifest 已写入且结构合法
        manifest_path = os.path.join(proj_dir, "project.precis.yaml")
        assert os.path.isfile(manifest_path)
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = yaml.safe_load(fh)
        assert manifest["version"] == 2
        assert manifest["project"]["name"] == "NewProj"
        assert manifest["schemas"] == []

        # 标准子目录已创建
        for sub in ["schemas", "constraints", "regex_nodes", "transforms", "patterns", "templates", "data", ".precis"]:
            assert os.path.isdir(os.path.join(proj_dir, sub)), f"缺少子目录: {sub}"

    def test_create_project_rejects_existing_manifest(self, tmp_path):
        client = TestClient(app)
        proj_dir = str(tmp_path / "existing")
        os.makedirs(proj_dir)
        # 预置一个 manifest，模拟已是合法项目
        with open(os.path.join(proj_dir, "project.precis.yaml"), "w", encoding="utf-8") as fh:
            fh.write("version: 2\n")
        resp = client.post(
            "/api/latest/projects/create",
            json={"path": proj_dir, "name": "X"},
        )
        assert resp.status_code == 400

    def test_create_project_id_is_stable_string(self, tmp_path):
        """创建的项目应有一个非空的 project.id。"""
        client = TestClient(app)
        proj_dir = str(tmp_path / "idcheck")
        resp = client.post(
            "/api/latest/projects/create",
            json={"path": proj_dir, "name": "IdCheck"},
        )
        assert resp.status_code == 200
        manifest_path = os.path.join(proj_dir, "project.precis.yaml")
        with open(manifest_path, encoding="utf-8") as fh:
            manifest = yaml.safe_load(fh)
        assert manifest["project"]["id"]
        assert isinstance(manifest["project"]["id"], str)
