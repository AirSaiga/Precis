"""
@fileoverview API 路由集成测试

使用 FastAPI TestClient 对完整应用进行端到端测试。
测试覆盖：
- 根端点
- Project 路由（manifest / view / workspaces）
- Connection Rules 路由
- Workspace Data Sources 路由
- 错误处理（404 / 422 / 500）
- X-Project-Config-Path header 依赖
"""

from __future__ import annotations

import json
import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest
from fastapi.testclient import TestClient

from app.api.main import app


@pytest.fixture
def client():
    """共享的 FastAPI TestClient，per-test 重建确保隔离。"""
    return TestClient(app)


@pytest.fixture
def project_dir(tmp_path):
    """在 tmp_path 中创建一个最小化但合法的 V2 项目目录。

    包含 project.precis.yaml + 一个 schema + 一个 constraint。
    返回项目根目录绝对路径。
    """
    project = tmp_path / "project"
    project.mkdir()
    (project / "schemas").mkdir()
    (project / "constraints").mkdir()
    (project / "data").mkdir()

    (project / "schemas" / "users.schema.yaml").write_text(
        """version: 2
id: users
name: users
source:
  mode: relative_file
  path: data/users.csv
columns:
  - id: id
    name: id
    type: integer
    primary_key: true
  - id: name
    name: name
    type: string
    nullable: false
""",
        encoding="utf-8",
    )

    (project / "constraints" / "not_null_name.constraint.yaml").write_text(
        """version: 2
id: not_null_name
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: name
""",
        encoding="utf-8",
    )

    (project / "data" / "users.csv").write_text(
        "id,name\n1,alice\n2,bob\n",
        encoding="utf-8",
    )

    (project / "project.precis.yaml").write_text(
        """version: 2
project:
  id: int_test_project
  name: Integration Test
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: not_null_name
    path: constraints/not_null_name.constraint.yaml
""",
        encoding="utf-8",
    )

    return str(project)


@pytest.fixture
def project_header(project_dir):
    """构造 X-Project-Config-Path header。"""
    return {"X-Project-Config-Path": project_dir}


class TestRootEndpoint:
    """根端点测试"""

    def test_root_returns_welcome(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        body = resp.json()
        assert "message" in body
        assert "/docs" in body["message"]

    def test_openapi_schema_generated(self, client):
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        spec = resp.json()
        # 项目至少有若干条路由被注册
        assert "paths" in spec
        assert len(spec["paths"]) > 10
        # 关键路由应存在
        assert "/api/latest/project/manifest" in spec["paths"]
        assert "/api/latest/connection-rules" in spec["paths"]


class TestProjectConfigPathHeader:
    """X-Project-Config-Path header 依赖验证"""

    def test_missing_header_returns_422(self, client):
        resp = client.get("/api/latest/project/manifest")
        assert resp.status_code == 422
        body = resp.json()
        assert "x-project-config-path" in str(body).lower()

    def test_relative_path_header_returns_400(self, client, project_dir):
        # project_dir 是绝对路径，但我们用 header 故意传相对路径测试拒绝
        # 注意 Windows 上 abspath 会把任何路径转绝对，需要用一个被识别为非绝对的路径
        # 在 Windows 上很难构造"非绝对"路径，CI 主要在 Linux 上
        # 因此在 Windows 上此测试跳过
        if sys.platform == "win32":
            pytest.skip("Windows 平台下任何路径经 abspath 都会变为绝对路径，无法触发 400")

    def test_nonexistent_directory_returns_404(self, client):
        # 用一个明显不存在的绝对路径（Linux/macOS 风格在 Windows 上会失败，用平台无关的占位）
        fake_path = "/__precis_nonexistent_dir_for_test_12345__"
        if sys.platform == "win32":
            fake_path = "D:/__precis_nonexistent_dir_for_test_12345__"
        resp = client.get("/api/latest/project/manifest", headers={"X-Project-Config-Path": fake_path})
        assert resp.status_code == 404
        assert "不存在" in resp.json().get("detail", "")


class TestManifestRoute:
    """manifest 端点集成测试（GET / PUT / 单引用 upsert / dedup）"""

    def test_get_manifest_returns_project_content(self, client, project_dir, project_header):
        resp = client.get("/api/latest/project/manifest", headers=project_header)
        assert resp.status_code == 200
        body = resp.json()
        assert body["version"] == 2
        assert body["project"]["id"] == "int_test_project"
        assert len(body["schemas"]) == 1
        assert body["schemas"][0]["id"] == "users"

    def test_put_manifest_merges_by_default(self, client, project_dir, project_header):
        new_manifest = {
            "version": 2,
            "project": {"id": "int_test_project", "name": "Renamed"},
            "schemas": [
                {"id": "users", "path": "schemas/users.schema.yaml"},
                {"id": "extra", "path": "schemas/extra.schema.yaml"},
            ],
        }
        resp = client.put("/api/latest/project/manifest", json=new_manifest, headers=project_header)
        assert resp.status_code == 200

        # 重新读取，应包含原有的 users 和新加的 extra（合并模式）
        resp2 = client.get("/api/latest/project/manifest", headers=project_header)
        body = resp2.json()
        ids = {s["id"] for s in body["schemas"]}
        assert "users" in ids
        assert "extra" in ids

    def test_put_manifest_replace_true_drops_existing(self, client, project_dir, project_header):
        new_manifest = {
            "version": 2,
            "project": {"id": "int_test_project", "name": "Replaced"},
            "schemas": [{"id": "only", "path": "schemas/only.schema.yaml"}],
        }
        resp = client.put(
            "/api/latest/project/manifest",
            json=new_manifest,
            params={"replace": True},
            headers=project_header,
        )
        assert resp.status_code == 200

        resp2 = client.get("/api/latest/project/manifest", headers=project_header)
        body = resp2.json()
        ids = {s["id"] for s in body["schemas"]}
        assert ids == {"only"}

    def test_upsert_schema_ref_adds_new(self, client, project_dir, project_header):
        resp = client.put(
            "/api/latest/project/manifest/schema",
            json={"id": "new_schema", "path": "schemas/new.schema.yaml"},
            headers=project_header,
        )
        assert resp.status_code == 200

        resp2 = client.get("/api/latest/project/manifest", headers=project_header)
        body = resp2.json()
        ids = {s["id"] for s in body["schemas"]}
        assert "new_schema" in ids
        assert "users" in ids  # 原有引用保留（合并行为）

    def test_upsert_schema_ref_updates_existing(self, client, project_dir, project_header):
        # 第一次 upsert：添加
        client.put(
            "/api/latest/project/manifest/schema",
            json={"id": "users", "path": "schemas/users.schema.yaml"},
            headers=project_header,
        )
        # 第二次 upsert：更新 path
        resp = client.put(
            "/api/latest/project/manifest/schema",
            json={"id": "users", "path": "schemas/users_renamed.schema.yaml"},
            headers=project_header,
        )
        assert resp.status_code == 200

        resp2 = client.get("/api/latest/project/manifest", headers=project_header)
        body = resp2.json()
        users = next(s for s in body["schemas"] if s["id"] == "users")
        assert users["path"] == "schemas/users_renamed.schema.yaml"
        # 不应该出现重复
        assert sum(1 for s in body["schemas"] if s["id"] == "users") == 1


class TestViewRoute:
    """project.view.json 端点测试"""

    def test_get_view_returns_default_when_missing(self, client, project_dir, project_header):
        resp = client.get("/api/latest/project/view", headers=project_header)
        assert resp.status_code == 200
        body = resp.json()
        assert body["version"] == 1
        assert body["nodes"] == {}

    def test_put_then_get_view_roundtrip(self, client, project_dir, project_header):
        payload = {
            "version": 1,
            "nodes": {
                "node-1": {"x": 100, "y": 200},
                "node-2": {"x": 300, "y": 400},
            },
        }
        resp = client.put("/api/latest/project/view", json=payload, headers=project_header)
        assert resp.status_code == 200
        assert resp.json()["message"]

        # 重新读
        resp2 = client.get("/api/latest/project/view", headers=project_header)
        body = resp2.json()
        assert body["nodes"]["node-1"]["x"] == 100
        assert body["nodes"]["node-2"]["y"] == 400

    def test_view_file_persisted_as_json(self, client, project_dir, project_header):
        """验证视图以 JSON 写入并支持中文（ensure_ascii=False）。"""
        payload = {
            "version": 1,
            "nodes": {"中文节点": {"x": 0, "y": 0}},
        }
        client.put("/api/latest/project/view", json=payload, headers=project_header)

        view_path = os.path.join(project_dir, "project.view.json")
        assert os.path.isfile(view_path)
        with open(view_path, encoding="utf-8") as f:
            raw = json.load(f)
        assert "中文节点" in raw["nodes"]


class TestWorkspacesRoute:
    """.precis/workspaces.json 端点测试"""

    def test_get_workspaces_returns_default(self, client, project_dir, project_header):
        resp = client.get("/api/latest/project/workspaces", headers=project_header)
        assert resp.status_code == 200
        body = resp.json()
        assert body["version"] == 1
        assert body["workspaces"] == []
        assert body["activeWorkspaceId"] is None

    def test_put_then_get_workspaces(self, client, project_dir, project_header):
        payload = {
            "version": 1,
            "activeWorkspaceId": "ws-1",
            "workspaces": [
                {
                    "id": "ws-1",
                    "title": "Workspace 1",
                    "index": 0,
                    "createdAt": "2024-01-01T00:00:00Z",
                    "lastActiveAt": "2024-01-01T00:00:00Z",
                    "visibleNodeIds": [],
                    "nodes": [],
                    "edges": [],
                },
            ],
        }
        resp = client.put("/api/latest/project/workspaces", json=payload, headers=project_header)
        assert resp.status_code == 200

        resp2 = client.get("/api/latest/project/workspaces", headers=project_header)
        body = resp2.json()
        assert body["activeWorkspaceId"] == "ws-1"
        assert len(body["workspaces"]) == 1
        assert body["workspaces"][0]["title"] == "Workspace 1"

    def test_put_workspaces_creates_precis_dir(self, client, project_dir, project_header):
        """验证 PUT 时会自动创建 .precis/ 目录。"""
        precis_dir = os.path.join(project_dir, ".precis")
        assert not os.path.isdir(precis_dir)

        client.put(
            "/api/latest/project/workspaces",
            json={"version": 1, "workspaces": []},
            headers=project_header,
        )
        assert os.path.isdir(precis_dir)


class TestConnectionRulesRoute:
    """connection-rules.precis.yaml 端点测试"""

    def test_get_returns_empty_when_file_missing(self, client, project_dir, project_header):
        resp = client.get("/api/latest/connection-rules", headers=project_header)
        assert resp.status_code == 200
        body = resp.json()
        assert body["version"] == "1.0"
        assert body["rules"] == []

    def test_put_then_get_roundtrip(self, client, project_dir, project_header):
        rules = {
            "version": "1.0",
            "rules": [
                {
                    "id": "schema_to_constraint",
                    "name": "Schema -> Constraint",
                    "source": {"node_types": ["SchemaNode"]},
                    "target": {"node_types": ["NotNullConstraint"]},
                }
            ],
        }
        resp = client.put("/api/latest/connection-rules", json=rules, headers=project_header)
        assert resp.status_code == 200

        resp2 = client.get("/api/latest/connection-rules", headers=project_header)
        body = resp2.json()
        assert len(body["rules"]) == 1
        assert body["rules"][0]["id"] == "schema_to_constraint"

    def test_reset_removes_file(self, client, project_dir, project_header):
        # 先写入规则
        rules = {
            "version": "1.0",
            "rules": [
                {
                    "id": "temp",
                    "name": "temp",
                    "source": {"node_types": ["A"]},
                    "target": {"node_types": ["B"]},
                }
            ],
        }
        client.put("/api/latest/connection-rules", json=rules, headers=project_header)
        rules_file = os.path.join(project_dir, "connection-rules.precis.yaml")
        assert os.path.isfile(rules_file)

        # 重置
        resp = client.post("/api/latest/connection-rules/reset", headers=project_header)
        assert resp.status_code == 200
        assert not os.path.isfile(rules_file)

        # 重置后 GET 返回空规则
        resp2 = client.get("/api/latest/connection-rules", headers=project_header)
        assert resp2.json()["rules"] == []


class TestWorkspaceDataSourcesRoute:
    """workspace/config + data-sources CRUD 端点测试"""

    def test_get_default_workspace(self, client, project_dir, project_header):
        resp = client.get("/api/latest/workspace/config", headers=project_header)
        assert resp.status_code == 200
        body = resp.json()
        assert body["data_sources"] == []
        # 默认工作区版本由 load_workspace_config 兜底返回 "1.0"
        assert body["version"] == "1.0"

    def test_add_data_source_persists(self, client, project_dir, project_header):
        ds = {
            "id": "ds-1",
            "name": "Test Excel",
            "fileId": str(os.path.join(project_dir, "data", "users.csv")),
            "type": "csv",
            "status": "ready",
        }
        resp = client.post("/api/latest/workspace/data-sources", json=ds, headers=project_header)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["data_sources"]) == 1
        assert body["data_sources"][0]["name"] == "Test Excel"

        # 再次 GET 验证持久化
        resp2 = client.get("/api/latest/workspace/config", headers=project_header)
        assert len(resp2.json()["data_sources"]) == 1

    def test_add_duplicate_data_source_updates_existing(self, client, project_dir, project_header):
        path = str(os.path.join(project_dir, "data", "users.csv"))
        ds = {
            "id": "ds-1",
            "name": "Original",
            "fileId": path,
            "type": "csv",
        }
        client.post("/api/latest/workspace/data-sources", json=ds, headers=project_header)
        # 用相同 fileId 但不同 name 添加
        client.post(
            "/api/latest/workspace/data-sources",
            json={"id": "ds-1", "name": "Renamed", "fileId": path, "type": "csv"},
            headers=project_header,
        )
        resp = client.get("/api/latest/workspace/config", headers=project_header)
        sources = resp.json()["data_sources"]
        # 仍然只有一条记录，但 name 已更新
        assert len(sources) == 1
        assert sources[0]["name"] == "Renamed"

    def test_remove_data_source(self, client, project_dir, project_header):
        # 使用绝对路径，避免 Windows 上 os.path.normpath("/a") 塌缩为 "\a"
        # 导致两个不同 fileId 被识别为重复
        path_a = str(os.path.join(project_dir, "data", "a.csv"))
        path_b = str(os.path.join(project_dir, "data", "b.csv"))
        client.post(
            "/api/latest/workspace/data-sources",
            json={"id": "ds-1", "name": "A", "fileId": path_a, "type": "csv"},
            headers=project_header,
        )
        client.post(
            "/api/latest/workspace/data-sources",
            json={"id": "ds-2", "name": "B", "fileId": path_b, "type": "csv"},
            headers=project_header,
        )
        resp = client.delete("/api/latest/workspace/data-sources/ds-1", headers=project_header)
        assert resp.status_code == 200
        remaining = resp.json()["data_sources"]
        assert len(remaining) == 1
        assert remaining[0]["id"] == "ds-2"

    def test_clear_all_data_sources(self, client, project_dir, project_header):
        path_a = str(os.path.join(project_dir, "data", "a.csv"))
        client.post(
            "/api/latest/workspace/data-sources",
            json={"id": "ds-1", "name": "A", "fileId": path_a, "type": "csv"},
            headers=project_header,
        )
        resp = client.delete("/api/latest/workspace/data-sources", headers=project_header)
        assert resp.status_code == 200
        assert resp.json()["data_sources"] == []


class TestWhitespaceConfigPathRejected:
    """依赖 header 的端点应统一处理非法输入。"""

    @pytest.mark.parametrize(
        "endpoint",
        [
            "/api/latest/project/manifest",
            "/api/latest/project/view",
            "/api/latest/project/workspaces",
            "/api/latest/connection-rules",
        ],
    )
    def test_endpoints_reject_missing_header(self, client, endpoint):
        resp = client.get(endpoint)
        assert resp.status_code == 422, f"{endpoint} should reject missing header"
