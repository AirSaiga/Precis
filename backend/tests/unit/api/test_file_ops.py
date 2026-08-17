from __future__ import annotations

import os
import tempfile

from fastapi.testclient import TestClient

from app.api.main import app


def _make_project_root(tmpdir: str) -> str:
    """构造含 manifest 的合法项目根（B-sec: files/ops 的 root 必须是合法 Precis 项目根）。"""
    manifest = os.path.join(tmpdir, "project.precis.yaml")
    with open(manifest, "w", encoding="utf-8") as f:
        f.write("project:\n  id: t\n")
    return tmpdir


def test_read_file():
    """B-sec1: read 需传入 root（白名单根），文件须落于 root 下。"""
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = _make_project_root(tmpdir)
        fpath = os.path.join(root, "readable.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("hello world")
        response = client.post("/api/latest/files/read", json={"path": fpath, "root": root})
        assert response.status_code == 200
        assert response.json()["content"] == "hello world"


def test_read_nonexistent_file():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = _make_project_root(tmpdir)
        response = client.post(
            "/api/latest/files/read",
            json={"path": os.path.join(root, "missing.txt"), "root": root},
        )
        assert response.status_code == 404


def test_write_file():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = _make_project_root(tmpdir)
        fpath = os.path.join(root, "subdir", "test.txt")
        response = client.post("/api/latest/files/write", json={"path": fpath, "content": "written", "root": root})
        assert response.status_code == 200
        assert response.json()["success"] is True
        assert os.path.isfile(fpath)
        with open(fpath, encoding="utf-8") as f:
            assert f.read() == "written"


def test_file_exists():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = _make_project_root(tmpdir)
        fname = os.path.join(root, "exists.txt")
        open(fname, "w").close()
        try:
            resp = client.get("/api/latest/files/exists", params={"path": fname, "root": root})
            assert resp.json()["exists"] is True
            resp = client.get(
                "/api/latest/files/exists",
                params={"path": os.path.join(root, "nonexistent"), "root": root},
            )
            assert resp.json()["exists"] is False
        finally:
            os.unlink(fname)


def test_scan_directory():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = _make_project_root(tmpdir)
        # create test structure
        open(os.path.join(root, "a.txt"), "w").close()
        open(os.path.join(root, "b.csv"), "w").close()
        os.makedirs(os.path.join(root, "sub"), exist_ok=True)
        resp = client.post("/api/latest/files/scan", json={"path": root, "root": root})
        assert resp.status_code == 200
        names = {e["name"] for e in resp.json()["entries"]}
        # manifest 文件也在项目根内,属合法可见内容
        assert {"a.txt", "b.csv", "sub", "project.precis.yaml"} <= names


def test_mkdir():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        root = _make_project_root(tmpdir)
        new_dir = os.path.join(root, "a", "b", "c")
        resp = client.post("/api/latest/files/mkdir", json={"path": new_dir, "root": root})
        assert resp.status_code == 200
        assert os.path.isdir(new_dir)
