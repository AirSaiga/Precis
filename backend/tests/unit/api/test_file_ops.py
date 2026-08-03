from __future__ import annotations

import os
import tempfile

from fastapi.testclient import TestClient

from app.api.main import app


def test_read_file():
    """B-sec1: read 需传入 root（白名单根），文件须落于 root 下。"""
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        fpath = os.path.join(tmpdir, "readable.txt")
        with open(fpath, "w", encoding="utf-8") as f:
            f.write("hello world")
        response = client.post("/api/latest/files/read", json={"path": fpath, "root": tmpdir})
        assert response.status_code == 200
        assert response.json()["content"] == "hello world"


def test_read_nonexistent_file():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        response = client.post(
            "/api/latest/files/read",
            json={"path": os.path.join(tmpdir, "missing.txt"), "root": tmpdir},
        )
        assert response.status_code == 404


def test_write_file():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        fpath = os.path.join(tmpdir, "subdir", "test.txt")
        response = client.post("/api/latest/files/write", json={"path": fpath, "content": "written", "root": tmpdir})
        assert response.status_code == 200
        assert response.json()["success"] is True
        assert os.path.isfile(fpath)
        with open(fpath, encoding="utf-8") as f:
            assert f.read() == "written"


def test_file_exists():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        fname = os.path.join(tmpdir, "exists.txt")
        open(fname, "w").close()
        try:
            resp = client.get("/api/latest/files/exists", params={"path": fname, "root": tmpdir})
            assert resp.json()["exists"] is True
            resp = client.get(
                "/api/latest/files/exists",
                params={"path": os.path.join(tmpdir, "nonexistent"), "root": tmpdir},
            )
            assert resp.json()["exists"] is False
        finally:
            os.unlink(fname)


def test_scan_directory():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        # create test structure
        open(os.path.join(tmpdir, "a.txt"), "w").close()
        open(os.path.join(tmpdir, "b.csv"), "w").close()
        os.makedirs(os.path.join(tmpdir, "sub"), exist_ok=True)
        resp = client.post("/api/latest/files/scan", json={"path": tmpdir, "root": tmpdir})
        assert resp.status_code == 200
        names = {e["name"] for e in resp.json()["entries"]}
        assert names == {"a.txt", "b.csv", "sub"}


def test_mkdir():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        new_dir = os.path.join(tmpdir, "a", "b", "c")
        resp = client.post("/api/latest/files/mkdir", json={"path": new_dir, "root": tmpdir})
        assert resp.status_code == 200
        assert os.path.isdir(new_dir)
