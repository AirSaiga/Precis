from __future__ import annotations

import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


@pytest.fixture
def valid_project():
    """创建一个有效的 Precis 项目目录。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "project.precis.yaml"), "w", encoding="utf-8") as f:
            f.write("project:\n  name: TestProject\n  id: test-001\nschemas: []\n")
        yield tmpdir


@pytest.fixture
def invalid_dir():
    """创建一个不含 project.precis.yaml 的目录。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_open_valid_project(valid_project):
    client = TestClient(app)
    response = client.post("/api/latest/projects/open", json={"path": valid_project})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["name"] == "TestProject"
    assert data["path"] == os.path.abspath(valid_project)

    # 验证 current 端点
    current = client.get("/api/latest/projects/current")
    assert current.status_code == 200
    assert current.json()["has_current"] is True


def test_open_nonexistent_project():
    client = TestClient(app)
    response = client.post("/api/latest/projects/open", json={"path": "/nonexistent"})
    assert response.status_code == 404


def test_open_invalid_project(invalid_dir):
    client = TestClient(app)
    response = client.post("/api/latest/projects/open", json={"path": invalid_dir})
    assert response.status_code == 400


def test_close_project(valid_project):
    client = TestClient(app)
    # 先打开
    client.post("/api/latest/projects/open", json={"path": valid_project})
    # 关闭
    response = client.post("/api/latest/projects/close")
    assert response.status_code == 200
    assert response.json()["success"] is True
    # 验证已关闭
    current = client.get("/api/latest/projects/current")
    assert current.json()["has_current"] is False


def test_current_when_no_project_open():
    client = TestClient(app)
    # 确保没有项目打开
    client.post("/api/latest/projects/close")
    response = client.get("/api/latest/projects/current")
    assert response.status_code == 200
    assert response.json()["has_current"] is False
