"""
@fileoverview 校验相关 API 行为集成测试

覆盖场景：
- 健康检查 / 版本号
- 项目全量校验 /validate/full
- 行内校验 /validate/inline
- 路径校验 /validate/path 与 /regex/path
- 批量校验 /validate/batch
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.main import app


def _make_project(tmp_path):
    """构造一个最小可校验项目：users 表 + not_null name 约束。"""
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "schemas").mkdir()
    (proj / "constraints").mkdir()
    (proj / "data").mkdir()

    (proj / "schemas" / "users.schema.yaml").write_text(
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
  - id: name
    name: name
    type: string
    nullable: false
""",
        encoding="utf-8",
    )

    (proj / "constraints" / "not_null_name.constraint.yaml").write_text(
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

    (proj / "data" / "users.csv").write_text("id,name\n1,alice\n2,bob\n", encoding="utf-8")

    (proj / "project.precis.yaml").write_text(
        """version: 2
project:
  id: validation_project
  name: Validation Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: not_null_name
    path: constraints/not_null_name.constraint.yaml
""",
        encoding="utf-8",
    )
    return str(proj)


class TestHealthAndVersion:
    """基础存活探测"""

    def test_health_returns_ok(self):
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_version_returns_semver(self):
        client = TestClient(app)
        resp = client.get("/api/latest/version")
        assert resp.status_code == 200
        assert "version" in resp.json()


class TestFullValidation:
    """全量校验 API 行为"""

    def test_validate_full_success(self, tmp_path):
        client = TestClient(app)
        proj_dir = _make_project(tmp_path)
        resp = client.post(
            "/api/latest/project/validate/full",
            json={"options": {}},
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["summary"]["error_count"] == 0
        assert body["summary"]["files_loaded"] >= 1

    def test_validate_full_missing_manifest_returns_404(self, tmp_path):
        client = TestClient(app)
        empty = tmp_path / "empty"
        empty.mkdir()
        resp = client.post(
            "/api/latest/project/validate/full",
            json={"options": {}},
            headers={"X-Project-Config-Path": str(empty)},
        )
        assert resp.status_code == 404
        assert "未找到" in resp.json()["detail"]


class TestInlineValidation:
    """行内校验 API 行为"""

    def test_inline_not_null_detects_empty(self):
        client = TestClient(app)
        resp = client.post(
            "/api/latest/validate/inline",
            json={
                "validation_type": "not_null",
                "target_column_name": "name",
                "column_names": ["name"],
                "rows": [["alice"], [""], ["bob"]],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["is_valid"] is False
        assert body["data"]["error_count"] > 0


class TestPathValidation:
    """基于文件路径的校验 API 行为"""

    def test_path_unique_detects_duplicate(self, tmp_path):
        client = TestClient(app)
        csv = tmp_path / "data.csv"
        csv.write_text("email\na@test.com\nb@test.com\na@test.com\n", encoding="utf-8")

        resp = client.post(
            "/api/latest/validate/path",
            json={
                "source_file_path": str(csv),
                "validation_type": "unique",
                "target_column_name": "email",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["is_valid"] is False
        assert body["data"]["error_count"] == 2

    def test_regex_path_matches_pattern(self, tmp_path):
        client = TestClient(app)
        csv = tmp_path / "data.csv"
        csv.write_text("code\nA001\nB002\nX\n", encoding="utf-8")

        resp = client.post(
            "/api/latest/regex/path",
            json={
                "source_file_path": str(csv),
                "target_column_name": "code",
                "regex_pattern": r"^[A-Z]\d{3}$",
                "match_mode": "full",
                "case_sensitive": True,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["data"]["is_valid"] is False
        assert body["data"]["error_count"] == 1

    def test_batch_path_validation(self, tmp_path):
        client = TestClient(app)
        csv = tmp_path / "data.csv"
        csv.write_text("email\na@test.com\nb@test.com\na@test.com\n", encoding="utf-8")

        resp = client.post(
            "/api/latest/validate/path/batch",
            json=[
                {
                    "source_file_path": str(csv),
                    "validation_type": "unique",
                    "target_column_name": "email",
                }
            ],
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 1
        assert body["results"][0]["success"] is True
        assert body["results"][0]["result"]["is_valid"] is False
