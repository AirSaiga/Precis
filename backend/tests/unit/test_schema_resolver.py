"""@fileoverview schema_resolver 单元测试

覆盖 find_matching_schemas 和 _resolve_id_from_name。
"""

from __future__ import annotations

import yaml

from app.shared.services.llm.schema_resolver import (
    _resolve_id_from_name,
    find_matching_schemas,
)


def _write_schema(tmp_path, schema: dict):
    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir(exist_ok=True)
    filepath = schemas_dir / f"{schema['id']}.schema.yaml"
    with open(filepath, "w", encoding="utf-8") as f:
        yaml.safe_dump(schema, f)


def _make_schema(id="users", name="用户表", columns=None):
    s = {"id": id, "name": name}
    if columns is not None:
        s["columns"] = columns
    return s


class TestFindMatchingSchemas:
    def test_exact_match_by_id(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="users", name="用户表"))
        results = find_matching_schemas(str(tmp_path), "users")
        assert len(results) == 1
        assert results[0]["id"] == "users"

    def test_exact_match_by_name(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="users", name="用户表"))
        results = find_matching_schemas(str(tmp_path), "用户表")
        assert len(results) == 1
        assert results[0]["name"] == "用户表"

    def test_fuzzy_match(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="users", name="系统用户表"))
        results = find_matching_schemas(str(tmp_path), "user")
        assert len(results) == 1

    def test_exact_match_preferred_over_fuzzy(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="users", name="用户"))
        _write_schema(tmp_path, _make_schema(id="user_profiles", name="用户详情"))
        results = find_matching_schemas(str(tmp_path), "users")
        assert len(results) == 1
        assert results[0]["id"] == "users"

    def test_empty_query_returns_empty(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        results = find_matching_schemas(str(tmp_path), "")
        assert results == []

    def test_no_schemas_dir_returns_empty(self, tmp_path):
        results = find_matching_schemas(str(tmp_path), "users")
        assert results == []

    def test_no_match_returns_empty(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="orders", name="订单表"))
        results = find_matching_schemas(str(tmp_path), "products")
        assert results == []

    def test_skips_malformed_schema(self, tmp_path):
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        bad_file = schemas_dir / "bad.schema.yaml"
        bad_file.write_text("not: valid\nid: null\n")
        results = find_matching_schemas(str(tmp_path), "anything")
        assert results == []


class TestResolveIdFromName:
    def test_resolves_table_id(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="users", name="用户表"))
        table_id, column_id = _resolve_id_from_name(str(tmp_path), "users")
        assert table_id == "users"
        assert column_id is None

    def test_resolves_table_and_column(self, tmp_path):
        _write_schema(
            tmp_path,
            _make_schema(
                id="users",
                name="用户表",
                columns=[
                    {"id": "col_email", "name": "email", "type": "string"},
                ],
            ),
        )
        table_id, column_id = _resolve_id_from_name(str(tmp_path), "users", "email")
        assert table_id == "users"
        assert column_id == "col_email"

    def test_resolves_column_by_id(self, tmp_path):
        _write_schema(
            tmp_path,
            _make_schema(
                id="users",
                name="用户表",
                columns=[{"id": "col_email", "name": "email", "type": "string"}],
            ),
        )
        _, column_id = _resolve_id_from_name(str(tmp_path), "users", "col_email")
        assert column_id == "col_email"

    def test_no_match_returns_none(self, tmp_path):
        table_id, column_id = _resolve_id_from_name(str(tmp_path), "nonexistent")
        assert table_id is None
        assert column_id is None
