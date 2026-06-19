from __future__ import annotations

import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


def test_upload_file():
    client = TestClient(app)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", encoding="utf-8", delete=False) as f:
        f.write("name,age\nAlice,30\nBob,25")
        fname = f.name
    try:
        with open(fname, "rb") as f:
            response = client.post("/api/latest/files/upload", files={"file": ("test.csv", f, "text/csv")})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["original_name"] == "test.csv"
        assert data["size"] > 0
        assert os.path.isfile(data["temp_path"])
        # clean up
        os.unlink(data["temp_path"])
    finally:
        os.unlink(fname)


def test_version():
    client = TestClient(app)
    response = client.get("/api/latest/version")
    assert response.status_code == 200
    assert "version" in response.json()
