"""
@fileoverview Schema 与 Template API 行为集成测试

覆盖场景：
- Schema CRUD（PUT / GET / check-conflict / DELETE / display-name）
- Template CRUD 与展开预览（POST / GET / expand）
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.main import app


class TestSchemaApi:
    """Schema 相关 HTTP API 行为测试"""

    def test_put_and_get_schema_roundtrip(self, tmp_path):
        """PUT schema 后 GET 应返回相同内容，且 manifest 自动更新。"""
        client = TestClient(app)
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "data").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: proj\n  name: Proj\nschemas: []\n",
            encoding="utf-8",
        )

        header = {"X-Project-Config-Path": str(proj)}
        payload = {
            "version": 2,
            "id": "users",
            "name": "users",
            "columns": [
                {"id": "id", "name": "id", "type": "integer"},
                {"id": "name", "name": "name", "type": "string"},
            ],
        }

        put_resp = client.put("/api/latest/project/schemas/users", json=payload, headers=header)
        assert put_resp.status_code == 200
        assert "已保存" in put_resp.json()["message"]

        get_resp = client.get("/api/latest/project/schemas/users", headers=header)
        assert get_resp.status_code == 200
        body = get_resp.json()
        assert body["id"] == "users"
        assert body["name"] == "users"
        assert len(body["columns"]) == 2

        # manifest 应自动包含该 schema 引用
        manifest_text = (proj / "project.precis.yaml").read_text(encoding="utf-8")
        assert "users" in manifest_text
        assert "schemas/users.schema.yaml" in manifest_text

    def test_check_conflict_detects_existing_schema(self, tmp_path):
        """check-conflict 应正确识别已存在 schema 并返回冲突字段。"""
        client = TestClient(app)
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "data").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: proj\n  name: Proj\nschemas: []\n",
            encoding="utf-8",
        )

        header = {"X-Project-Config-Path": str(proj)}
        client.put(
            "/api/latest/project/schemas/users",
            json={
                "version": 2,
                "id": "users",
                "name": "users",
                "columns": [{"id": "id", "name": "id", "type": "integer"}],
            },
            headers=header,
        )

        resp = client.post(
            "/api/latest/project/schemas/users/check-conflict",
            json={
                "version": 2,
                "id": "users",
                "name": "users",
                "columns": [{"id": "id", "name": "id", "type": "string"}],
            },
            headers=header,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["exists"] is True
        assert body["has_conflict"] is True
        assert "columns" in body["conflict_fields"]

    def test_delete_schema_removes_file_and_manifest_ref(self, tmp_path):
        """DELETE schema 应删除文件并从 manifest 移除引用。"""
        client = TestClient(app)
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "data").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: proj\n  name: Proj\nschemas: []\n",
            encoding="utf-8",
        )

        header = {"X-Project-Config-Path": str(proj)}
        client.put(
            "/api/latest/project/schemas/users",
            json={
                "version": 2,
                "id": "users",
                "name": "users",
                "columns": [{"id": "id", "name": "id", "type": "integer"}],
            },
            headers=header,
        )

        del_resp = client.delete("/api/latest/project/schemas/users", headers=header)
        assert del_resp.status_code == 200
        assert "已删除" in del_resp.json()["message"]

        assert not (proj / "schemas" / "users.schema.yaml").exists()
        manifest_text = (proj / "project.precis.yaml").read_text(encoding="utf-8")
        assert "schemas: []" in manifest_text

    def test_update_schema_display_name(self, tmp_path):
        """display-name 接口应更新 schema 的 name 字段。"""
        client = TestClient(app)
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "data").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: proj\n  name: Proj\nschemas: []\n",
            encoding="utf-8",
        )

        header = {"X-Project-Config-Path": str(proj)}
        client.put(
            "/api/latest/project/schemas/users",
            json={
                "version": 2,
                "id": "users",
                "name": "users",
                "columns": [{"id": "id", "name": "id", "type": "integer"}],
            },
            headers=header,
        )

        resp = client.post("/api/latest/project/schemas/users/display-name", json={"name": "用户表"}, headers=header)
        assert resp.status_code == 200

        get_resp = client.get("/api/latest/project/schemas/users", headers=header)
        assert get_resp.json()["name"] == "用户表"


class TestTemplateApi:
    """Template 相关 HTTP API 行为测试"""

    def _create_minimal_project(self, tmp_path):
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "templates").mkdir()
        (proj / "data").mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject:\n  id: proj\n  name: Proj\nschemas: []\ntemplates: []\n",
            encoding="utf-8",
        )
        return proj

    def test_create_list_get_template(self, tmp_path):
        """创建模板后 list / get 应返回正确内容。"""
        client = TestClient(app)
        proj = self._create_minimal_project(tmp_path)
        header = {"X-Project-Config-Path": str(proj)}

        create_resp = client.post(
            "/api/latest/project/template",
            json={
                "version": 2,
                "id": "age_check",
                "name": "年龄校验",
                "parameters": [
                    {"id": "min_age", "type": "integer", "label": "最小年龄", "required": True, "default": 18}
                ],
                "nodes": [
                    {
                        "id": "check_range",
                        "kind": "constraint",
                        "type": "Range",
                        "refs": {"table_id": "users", "column_id": "age"},
                        "params": {"min": "{{min_age}}"},
                    }
                ],
            },
            headers=header,
        )
        assert create_resp.status_code == 200
        assert create_resp.json()["success"] is True

        list_resp = client.get("/api/latest/project/template", headers=header)
        assert list_resp.status_code == 200
        items = list_resp.json()
        assert len(items) == 1
        assert items[0]["id"] == "age_check"

        get_resp = client.get("/api/latest/project/template/age_check", headers=header)
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == "age_check"

    def test_expand_template_preview(self, tmp_path):
        """expand 接口应返回展开后的约束/转换/正则节点。"""
        client = TestClient(app)
        proj = self._create_minimal_project(tmp_path)
        header = {"X-Project-Config-Path": str(proj)}

        client.post(
            "/api/latest/project/template",
            json={
                "version": 2,
                "id": "email_regex",
                "name": "邮箱正则",
                "parameters": [],
                "nodes": [
                    {
                        "id": "extract_email",
                        "kind": "regex",
                        "type": "RegexExtract",
                        "input_from_node": "{{input_anchor}}",
                        "input_column": "contact",
                        "params": {"pattern": r"[\w\.]+@[\w\.]+"},
                        "output_columns": ["email"],
                    }
                ],
            },
            headers=header,
        )

        resp = client.post(
            "/api/latest/project/template/email_regex/expand",
            json={"instance_id": "inst_1", "params": {}, "input_from_node": "users"},
            headers=header,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["regex_nodes"]) == 1
        assert body["regex_nodes"][0]["id"] == "inst_1__extract_email"
        assert body["regex_nodes"][0]["input_from_node"] == "users"
