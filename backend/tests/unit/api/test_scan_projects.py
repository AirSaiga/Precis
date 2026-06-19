from __future__ import annotations

import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


@pytest.fixture
def work_dir_with_projects():
    """创建一个包含多个项目的临时工作目录。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 项目 1: 完整项目
        proj1 = os.path.join(tmpdir, "project-alpha")
        os.makedirs(proj1)
        with open(os.path.join(proj1, "project.precis.yaml"), "w", encoding="utf-8") as f:
            f.write("project:\n  name: Alpha\n  id: alpha-001\nschemas:\n  - id: sc_users\n")
        constraints_dir = os.path.join(proj1, "constraints")
        os.makedirs(constraints_dir, exist_ok=True)
        with open(os.path.join(constraints_dir, "c1.constraint.yaml"), "w") as f:
            f.write("kind: NotNull\n")

        # 项目 2: 无 constraints
        proj2 = os.path.join(tmpdir, "project-beta")
        os.makedirs(proj2)
        with open(os.path.join(proj2, "project.precis.yaml"), "w", encoding="utf-8") as f:
            f.write("project:\n  name: Beta\n  id: beta-002\nschemas: []\n")

        # 目录 3: 无 project.precis.yaml（不是项目）
        non_proj = os.path.join(tmpdir, "not-a-project")
        os.makedirs(non_proj)

        yield tmpdir


def test_scan_returns_projects_in_work_dir(work_dir_with_projects):
    client = TestClient(app)
    response = client.get("/api/latest/projects/scan", params={"work_dir": work_dir_with_projects})
    assert response.status_code == 200
    data = response.json()
    assert data["work_dir"] == work_dir_with_projects
    assert len(data["projects"]) == 2
    names = {p["name"] for p in data["projects"]}
    assert names == {"Alpha", "Beta"}


def test_scan_empty_directory():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        response = client.get("/api/latest/projects/scan", params={"work_dir": tmpdir})
        assert response.status_code == 200
        assert response.json()["projects"] == []


def test_scan_nonexistent_directory():
    client = TestClient(app)
    response = client.get("/api/latest/projects/scan", params={"work_dir": "/nonexistent/path"})
    assert response.status_code == 400


def test_scan_without_required_param():
    client = TestClient(app)
    response = client.get("/api/latest/projects/scan")
    assert response.status_code == 400
    assert "请指定 work_dir" in response.json()["detail"]


def test_scan_uses_env_var_fallback():
    """当不传 work_dir 时，应从 PRECIS_WORK_DIR 环境变量读取。"""
    import os
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        proj = os.path.join(tmpdir, "env-project")
        os.makedirs(proj)
        with open(os.path.join(proj, "project.precis.yaml"), "w", encoding="utf-8") as f:
            f.write("project:\n  name: EnvProject\nschemas: []\n")

        old_env = os.environ.get("PRECIS_WORK_DIR")
        try:
            os.environ["PRECIS_WORK_DIR"] = tmpdir
            client = TestClient(app)
            response = client.get("/api/latest/projects/scan")
            assert response.status_code == 200
            assert len(response.json()["projects"]) == 1
            assert response.json()["projects"][0]["name"] == "EnvProject"
        finally:
            if old_env:
                os.environ["PRECIS_WORK_DIR"] = old_env
            else:
                del os.environ["PRECIS_WORK_DIR"]
