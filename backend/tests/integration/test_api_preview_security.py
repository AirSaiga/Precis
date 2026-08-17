"""preview 路由路径安全约束测试。

B-sec: /preview/file 此前无任何路径校验(连 `..`/相对路径都不拦截),是约束最弱的
文件读取口;姊妹端点 /file/path 与 /switch-sheet 均已调 validate_file_access。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


@pytest.fixture
def client():
    return TestClient(app)


class TestPreviewFilePathValidation:
    """/preview/file 的路径校验行为(与 /file/path 对齐)。"""

    def test_dotdot_path_rejected(self, client):
        resp = client.post("/api/latest/preview/file", json={"file_path": "../../etc/passwd"})
        assert resp.status_code == 400
        assert ".." in resp.json().get("detail", "")

    def test_relative_path_rejected(self, client):
        """相对路径 resolve 到后端 CWD,行为隐蔽,应拒绝(要求绝对路径)"""
        resp = client.post("/api/latest/preview/file", json={"file_path": "data/sample.csv"})
        assert resp.status_code in (400, 404)

    def test_nonexistent_absolute_path_returns_404(self, client, tmp_path):
        resp = client.post("/api/latest/preview/file", json={"file_path": str(tmp_path / "no_such.csv")})
        assert resp.status_code == 404

    def test_absolute_csv_path_previews(self, client, tmp_path):
        """合法绝对路径的数据文件正常预览(不破坏正常功能)"""
        f = tmp_path / "sample.csv"
        f.write_text("a,b\n1,2\n", encoding="utf-8")
        resp = client.post("/api/latest/preview/file", json={"file_path": str(f), "max_rows": 10, "max_cols": 10})
        assert resp.status_code == 200
        assert resp.json()["success"] is True
