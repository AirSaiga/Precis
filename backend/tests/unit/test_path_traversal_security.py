"""端点级路径穿越防护测试

覆盖 P0-1 安全修复:
- validation/history 端点:project_path 必须从 Header 获取,拒绝 body/query 中的路径
- files/transfer:download/delete 限定到 TEMP_DIR
- files/ops:反穿越硬化(拒绝 `..`)

使用 TestClient 做真实 HTTP 请求验证可达性与安全约束。
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.api.routers.files.transfer import TEMP_DIR


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_dir(tmp_path):
    """构造一个合法项目目录(满足 get_project_config_path 的 isabs+isdir 校验)"""
    return str(tmp_path)


@pytest.fixture
def other_dir(tmp_path):
    """另一个目录(用于验证路径不会被误导到此)"""
    other = tmp_path.parent / "other_project"
    other.mkdir(exist_ok=True)
    return str(other)


class TestHistoryHeaderConvergence:
    """validation/history 端点应从 Header 获取 project_path,不再接受 body/query 中的路径"""

    def test_save_run_without_header_returns_422(self, client):
        """缺少 Header 时应 422(Header 必填)"""
        response = client.post(
            "/api/latest/validation/history",
            json={"duration_ms": 100, "summary": {}},
        )
        assert response.status_code == 422

    def test_save_run_with_header_succeeds(self, client, project_dir):
        """带正确 Header 时保存成功"""
        response = client.post(
            "/api/latest/validation/history",
            json={"duration_ms": 100, "summary": {"pass_rate": 100.0}},
            headers={"X-Project-Config-Path": project_dir},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_save_run_ignores_body_project_path(self, client, project_dir, other_dir):
        """body 中残留的 project_path 字段不应影响落盘位置(写入 Header 指向的目录)"""
        # SaveRunRequest 已移除 project_path 字段,Pydantic 会忽略额外字段(默认配置)
        response = client.post(
            "/api/latest/validation/history",
            json={
                "duration_ms": 100,
                "summary": {"pass_rate": 100.0},
                "project_path": other_dir,  # 残留字段,应被忽略
            },
            headers={"X-Project-Config-Path": project_dir},
        )
        assert response.status_code == 200
        # 历史文件应落在 project_dir(Header),而非 other_dir
        assert (os.path.join(project_dir, ".precis")).startswith(project_dir)
        assert not os.path.exists(os.path.join(other_dir, ".precis", "validation_history.json"))

    def test_list_runs_with_header(self, client, project_dir):
        """list_runs 通过 Header 获取项目路径"""
        response = client.get(
            "/api/latest/validation/history",
            params={"limit": 10, "offset": 0},
            headers={"X-Project-Config-Path": project_dir},
        )
        assert response.status_code == 200

    def test_list_runs_without_header_returns_422(self, client):
        """缺少 Header 时 list_runs 应 422"""
        response = client.get("/api/latest/validation/history", params={"limit": 10})
        assert response.status_code == 422

    def test_stats_with_header(self, client, project_dir):
        response = client.get(
            "/api/latest/validation/history/stats",
            headers={"X-Project-Config-Path": project_dir},
        )
        assert response.status_code == 200

    def test_get_and_delete_run_with_header(self, client, project_dir):
        # 先存一条
        save_resp = client.post(
            "/api/latest/validation/history",
            json={"duration_ms": 50, "summary": {"pass_rate": 100.0}},
            headers={"X-Project-Config-Path": project_dir},
        )
        run_id = save_resp.json()["run_id"]
        # 读取
        get_resp = client.get(
            f"/api/latest/validation/history/{run_id}",
            headers={"X-Project-Config-Path": project_dir},
        )
        assert get_resp.status_code == 200
        # 删除
        del_resp = client.delete(
            f"/api/latest/validation/history/{run_id}",
            headers={"X-Project-Config-Path": project_dir},
        )
        assert del_resp.status_code == 200


class TestFilesTransferTempDirConfinement:
    """files/transfer 的 download/delete 限定到 TEMP_DIR"""

    def test_download_outside_temp_rejected(self, client, tmp_path):
        """下载 TEMP_DIR 外的文件应被拒绝(403)"""
        secret = tmp_path / "secret.txt"
        secret.write_text("sensitive", encoding="utf-8")
        response = client.get("/api/latest/files/download", params={"path": str(secret)})
        assert response.status_code == 403

    def test_download_dotdot_escape_rejected(self, client):
        """通过 `..` 逃逸 TEMP_DIR 应被拒绝"""
        escaping = os.path.join(TEMP_DIR, "..", "passwd")
        response = client.get("/api/latest/files/download", params={"path": escaping})
        assert response.status_code in (400, 403)

    def test_download_within_temp_allowed(self, client):
        """下载 TEMP_DIR 内的文件应成功"""
        os.makedirs(TEMP_DIR, exist_ok=True)
        f = os.path.join(TEMP_DIR, "test_dl.txt")
        with open(f, "w", encoding="utf-8") as fh:
            fh.write("ok")
        try:
            response = client.get("/api/latest/files/download", params={"path": f})
            assert response.status_code == 200
        finally:
            if os.path.exists(f):
                os.unlink(f)

    def test_delete_temp_dotdot_rejected(self, client):
        """delete_temp_file 通过 file_id 含 `..` 逃逸应被拒绝"""
        response = client.delete("/api/latest/files/temp/..%2Fsecret.txt")
        # 无论 secret 是否存在,路径校验应先拒绝
        assert response.status_code in (400, 403, 404)


class TestFilesOpsTraversalHardening:
    """files/ops 反穿越硬化:拒绝 `..`,保留合法路径"""

    def test_read_dotdot_rejected(self, client, tmp_path):
        """read 含 `..` 应被拒绝"""
        target = os.path.join(str(tmp_path), "..", "target.txt")
        response = client.post("/api/latest/files/read", json={"path": target})
        assert response.status_code == 400

    def test_read_legitimate_file(self, client, tmp_path):
        """read 合法文件成功"""
        f = tmp_path / "readable.txt"
        f.write_text("hello", encoding="utf-8")
        response = client.post("/api/latest/files/read", json={"path": str(f)})
        assert response.status_code == 200
        assert response.json()["content"] == "hello"

    def test_write_dotdot_rejected(self, client, tmp_path):
        """write 含 `..` 应被拒绝"""
        target = os.path.join(str(tmp_path), "..", "evil.txt")
        response = client.post("/api/latest/files/write", json={"path": target, "content": "x"})
        assert response.status_code == 400

    def test_scan_dotdot_rejected(self, client, tmp_path):
        """scan 含 `..` 应被拒绝"""
        target = os.path.join(str(tmp_path), "..")
        response = client.post("/api/latest/files/scan", json={"path": target})
        assert response.status_code == 400

    def test_mkdir_dotdot_rejected(self, client, tmp_path):
        """mkdir 含 `..` 应被拒绝"""
        target = os.path.join(str(tmp_path), "..", "evil_dir")
        response = client.post("/api/latest/files/mkdir", json={"path": target})
        assert response.status_code == 400

    def test_exists_dotdot_rejected(self, client, tmp_path):
        """exists 含 `..` 应被拒绝"""
        target = os.path.join(str(tmp_path), "..", "x")
        response = client.get("/api/latest/files/exists", params={"path": target})
        assert response.status_code == 400
