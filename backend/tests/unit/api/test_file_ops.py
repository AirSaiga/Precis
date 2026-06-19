from __future__ import annotations

import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


def test_read_file():
    client = TestClient(app)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write("hello world")
        fpath = f.name
    try:
        response = client.post("/api/latest/files/read", json={"path": fpath})
        assert response.status_code == 200
        assert response.json()["content"] == "hello world"
    finally:
        os.unlink(fpath)


def test_read_nonexistent_file():
    client = TestClient(app)
    response = client.post("/api/latest/files/read", json={"path": "/nonexistent/file.txt"})
    assert response.status_code == 404


def test_write_file():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        fpath = os.path.join(tmpdir, "subdir", "test.txt")
        response = client.post("/api/latest/files/write", json={"path": fpath, "content": "written"})
        assert response.status_code == 200
        assert response.json()["success"] is True
        assert os.path.isfile(fpath)
        with open(fpath, encoding="utf-8") as f:
            assert f.read() == "written"


def test_file_exists():
    client = TestClient(app)
    with tempfile.NamedTemporaryFile(delete=False) as f:
        fname = f.name
    try:
        resp = client.get(f"/api/latest/files/exists?path={fname}")
        assert resp.json()["exists"] is True
        resp = client.get("/api/latest/files/exists?path=/nonexistent")
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
        resp = client.post("/api/latest/files/scan", json={"path": tmpdir})
        assert resp.status_code == 200
        names = {e["name"] for e in resp.json()["entries"]}
        assert names == {"a.txt", "b.csv", "sub"}


def test_mkdir():
    client = TestClient(app)
    with tempfile.TemporaryDirectory() as tmpdir:
        new_dir = os.path.join(tmpdir, "a", "b", "c")
        resp = client.post("/api/latest/files/mkdir", json={"path": new_dir})
        assert resp.status_code == 200
        assert os.path.isdir(new_dir)
