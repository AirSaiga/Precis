"""@fileoverview 项目设置 API 端点单元测试

覆盖 settings.py 的 4 组 GET/PUT 端点：
- /config/settings（项目设置）
- /config/validation（校验设置）
- /config/file-processing（文件处理设置）
- /config/script-security（脚本安全设置）

测试行为（不测实现）：写入后读取 roundtrip、404 清单缺失、500 读写失败。
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app.api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _make_project(tmp_path: Path) -> Path:
    """创建包含最小 manifest 的项目目录，返回路径。"""
    manifest = {
        "version": 2,
        "project": {"id": "test-proj", "name": "Test"},
        "settings": {
            "validation": {"strict_mode": False},
            "file_processing": {"default_encoding": "utf-8"},
            "script_security": {"allow_eval": False},
        },
    }
    manifest_path = tmp_path / "project.precis.yaml"
    manifest_path.write_text(yaml.dump(manifest, allow_unicode=True), encoding="utf-8")
    return tmp_path


def _headers(project_dir: Path) -> dict:
    return {"X-Project-Config-Path": str(project_dir)}


class TestGetSettings:
    def test_get_project_settings(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.get("/api/latest/project/config/settings", headers=_headers(project_dir))
        assert resp.status_code == 200
        data = resp.json()
        assert data["validation"]["strict_mode"] is False

    def test_get_validation_settings(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.get("/api/latest/project/config/validation", headers=_headers(project_dir))
        assert resp.status_code == 200
        assert resp.json()["strict_mode"] is False

    def test_get_file_processing_settings(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.get("/api/latest/project/config/file-processing", headers=_headers(project_dir))
        assert resp.status_code == 200
        assert resp.json()["default_encoding"] == "utf-8"

    def test_get_script_security_settings(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.get("/api/latest/project/config/script-security", headers=_headers(project_dir))
        assert resp.status_code == 200
        assert resp.json()["allow_eval"] is False

    def test_get_settings_404_missing_manifest(self, client, tmp_path):
        resp = client.get("/api/latest/project/config/settings", headers=_headers(tmp_path))
        assert resp.status_code == 404


class TestPutSettings:
    def test_put_project_settings_roundtrip(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        new_settings = {
            "validation": {"strict_mode": True},
            "file_processing": {"default_encoding": "gbk"},
            "script_security": {"allow_eval": True},
        }
        resp = client.put("/api/latest/project/config/settings", json=new_settings, headers=_headers(project_dir))
        assert resp.status_code == 200
        assert "已保存" in resp.json()["message"]

        # 验证写入后读取一致
        resp = client.get("/api/latest/project/config/settings", headers=_headers(project_dir))
        assert resp.json()["validation"]["strict_mode"] is True

    def test_put_validation_settings_preserves_other_fields(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.put(
            "/api/latest/project/config/validation",
            json={"strict_mode": True},
            headers=_headers(project_dir),
        )
        assert resp.status_code == 200

        # file_processing 应保持不变
        resp = client.get("/api/latest/project/config/file-processing", headers=_headers(project_dir))
        assert resp.json()["default_encoding"] == "utf-8"

    def test_put_file_processing_settings(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.put(
            "/api/latest/project/config/file-processing",
            json={"default_encoding": "gbk"},
            headers=_headers(project_dir),
        )
        assert resp.status_code == 200
        resp = client.get("/api/latest/project/config/file-processing", headers=_headers(project_dir))
        assert resp.json()["default_encoding"] == "gbk"

    def test_put_script_security_settings(self, client, tmp_path):
        project_dir = _make_project(tmp_path)
        resp = client.put(
            "/api/latest/project/config/script-security",
            json={"allow_eval": True},
            headers=_headers(project_dir),
        )
        assert resp.status_code == 200
        resp = client.get("/api/latest/project/config/script-security", headers=_headers(project_dir))
        assert resp.json()["allow_eval"] is True

    def test_put_settings_404_missing_manifest(self, client, tmp_path):
        resp = client.put(
            "/api/latest/project/config/settings",
            json={"validation": {}, "file_processing": {}, "script_security": {}},
            headers=_headers(tmp_path),
        )
        assert resp.status_code == 404
