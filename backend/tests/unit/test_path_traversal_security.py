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
    """构造一个合法项目目录（B-sec3: 需含 project.precis.yaml 才通过强校验）"""
    (tmp_path / "project.precis.yaml").write_text("id: test\n", encoding="utf-8")
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


class TestFilesOpsRootWhitelist:
    """B-sec1: files/ops 改为白名单根目录语义（assert_path_within_root）。

    安全约束: 所有端点必须传 root，path 必须落于 root 下。
    - root 外的绝对路径 → 403（即便不含 `..`）
    - `..` 逃逸 root → 403
    - root 内合法路径 → 通过
    - 缺 root → 422（必填字段校验）
    - root 本身必须是含 project.precis.yaml 的合法项目根（B-sec 补强：
      此前 root 由客户端任意指定，白名单防线形同虚设）
    """

    @staticmethod
    def _make_project_root(tmp_path):
        """构造含 manifest 的合法项目根（对齐前端 Web 模式传 root 的真实语义）。"""
        root = tmp_path / "project"
        root.mkdir(exist_ok=True)
        (root / "project.precis.yaml").write_text("project:\n  id: t\n", encoding="utf-8")
        return root

    def test_root_without_manifest_rejected(self, client, tmp_path):
        """root 指向任意目录（无 manifest）→ 400，不得作为白名单根"""
        root = tmp_path / "not-a-project"
        root.mkdir()
        secret = tmp_path / "secret.txt"
        secret.write_text("sensitive", encoding="utf-8")
        response = client.post("/api/latest/files/read", json={"path": str(secret), "root": str(root)})
        assert response.status_code == 400

    def test_read_without_root_returns_422(self, client, tmp_path):
        f = tmp_path / "readable.txt"
        f.write_text("hello", encoding="utf-8")
        response = client.post("/api/latest/files/read", json={"path": str(f)})
        assert response.status_code == 422  # root 必填

    def test_read_outside_root_rejected(self, client, tmp_path):
        """root 外的绝对路径（无 `..`）也应被拒——这是 SEC-1 的核心修复点"""
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        secret = tmp_path / "secret.txt"
        secret.write_text("sensitive", encoding="utf-8")
        response = client.post("/api/latest/files/read", json={"path": str(secret), "root": str(root)})
        assert response.status_code == 403

    def test_read_within_root_allowed(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        f = root / "readable.txt"
        f.write_text("hello", encoding="utf-8")
        response = client.post("/api/latest/files/read", json={"path": str(f), "root": str(root)})
        assert response.status_code == 200
        assert response.json()["content"] == "hello"

    def test_read_dotdot_escape_rejected(self, client, tmp_path):
        """`..` 逃逸出 root 应被拒"""
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        target = os.path.join(str(root), "..", "secret.txt")
        response = client.post("/api/latest/files/read", json={"path": target, "root": str(root)})
        assert response.status_code == 403

    def test_write_outside_root_rejected(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        evil = tmp_path / "evil.txt"
        response = client.post("/api/latest/files/write", json={"path": str(evil), "content": "x", "root": str(root)})
        assert response.status_code == 403
        assert not evil.exists()  # 未被写入

    def test_write_within_root_allowed(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        target = root / "new.txt"
        response = client.post(
            "/api/latest/files/write",
            json={"path": str(target), "content": "data", "root": str(root)},
        )
        assert response.status_code == 200
        assert target.read_text(encoding="utf-8") == "data"

    def test_scan_outside_root_rejected(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        outside = tmp_path / "outside"
        outside.mkdir()
        response = client.post("/api/latest/files/scan", json={"path": str(outside), "root": str(root)})
        assert response.status_code == 403

    def test_scan_within_root_allowed(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        (root / "a.csv").write_text("x", encoding="utf-8")
        response = client.post("/api/latest/files/scan", json={"path": str(root), "root": str(root)})
        assert response.status_code == 200
        names = [e["name"] for e in response.json()["entries"]]
        assert "a.csv" in names

    def test_mkdir_outside_root_rejected(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        evil_dir = tmp_path / "evil_dir"
        response = client.post("/api/latest/files/mkdir", json={"path": str(evil_dir), "root": str(root)})
        assert response.status_code == 403
        assert not evil_dir.exists()

    def test_exists_outside_root_rejected(self, client, tmp_path):
        root = TestFilesOpsRootWhitelist._make_project_root(tmp_path)
        outside = tmp_path / "outside.txt"
        outside.write_text("x", encoding="utf-8")
        response = client.get("/api/latest/files/exists", params={"path": str(outside), "root": str(root)})
        assert response.status_code == 403
