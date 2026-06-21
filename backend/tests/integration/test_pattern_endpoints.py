"""
@fileoverview Pattern CRUD API 集成测试

覆盖 GET /pattern（列表）、PUT /pattern/{name}（更新）、DELETE /pattern/{name}（删除）。
POST 与 exists 已有实现，此处补全 CRUD。
"""

from __future__ import annotations

import os

import yaml
from fastapi.testclient import TestClient

from app.api.main import app


def _make_project_with_pattern(tmp_path) -> str:
    """构造含一个 pattern 的项目。"""
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "patterns").mkdir()
    (proj / "patterns" / "semver.yaml").write_text(
        "name: semver\nregex: '^v\\\\d+\\.\\\\d+\\.\\\\d+$'\noutput:\n  type: semver\n",
        encoding="utf-8",
    )
    (proj / "project.precis.yaml").write_text(
        "version: 2\n"
        "project:\n"
        "  id: pat_proj\n"
        "  name: Pattern Project\n"
        "patterns_dir: patterns\n"
        "schemas: []\n"
        "constraints: []\n"
        "regex_nodes: []\n"
        "transforms: []\n"
        "templates: []\n"
        "template_instances: []\n"
        "warnings: []\n",
        encoding="utf-8",
    )
    return str(proj)


class TestPatternList:
    def test_list_patterns_returns_all(self, tmp_path):
        client = TestClient(app)
        proj_dir = _make_project_with_pattern(tmp_path)
        resp = client.get(
            "/api/latest/project/pattern",
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert any(p["name"] == "semver" for p in body)

    def test_list_patterns_empty_dir_returns_empty_list(self, tmp_path):
        client = TestClient(app)
        proj = tmp_path / "empty"
        proj.mkdir()
        (proj / "patterns").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: e\n  name: e\npatterns_dir: patterns\n",
            encoding="utf-8",
        )
        resp = client.get(
            "/api/latest/project/pattern",
            headers={"X-Project-Config-Path": str(proj)},
        )
        assert resp.status_code == 200
        assert resp.json() == []


class TestPatternUpdate:
    def test_update_pattern_overwrites_file(self, tmp_path):
        client = TestClient(app)
        proj_dir = _make_project_with_pattern(tmp_path)
        resp = client.put(
            "/api/latest/project/pattern/semver",
            json={"name": "semver", "regex": "^\\d+$", "output": None},
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code == 200
        # 验证文件已被覆盖
        with open(os.path.join(proj_dir, "patterns", "semver.yaml"), encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        assert data["regex"] == "^\\d+$"

    def test_update_nonexistent_returns_404(self, tmp_path):
        client = TestClient(app)
        proj_dir = _make_project_with_pattern(tmp_path)
        resp = client.put(
            "/api/latest/project_pattern/ghost",
            json={"name": "ghost", "regex": ".*"},
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code == 404


class TestPatternDelete:
    def test_delete_pattern_removes_file(self, tmp_path):
        client = TestClient(app)
        proj_dir = _make_project_with_pattern(tmp_path)
        target = os.path.join(proj_dir, "patterns", "semver.yaml")
        assert os.path.isfile(target)
        resp = client.delete(
            "/api/latest/project/pattern/semver",
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code == 200
        assert not os.path.isfile(target)

    def test_delete_nonexistent_returns_404(self, tmp_path):
        client = TestClient(app)
        proj_dir = _make_project_with_pattern(tmp_path)
        resp = client.delete(
            "/api/latest/project/pattern/ghost",
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code == 404
