"""
@fileoverview Schema reader 辅助函数单元测试

测试 schema_column_name_by_id、schema_column_id_by_name、build_runtime_schema。
"""

import pytest

from app.shared.core.project.schema.reader import (
    load_schema,
    schema_column_id_by_name,
    schema_column_name_by_id,
)
from app.shared.core.project.schema.types import ColumnSpec, TableSchemaFile
from app.shared.services.schema_runtime_builder import build_runtime_schema


class TestSchemaColumnMappings:
    def test_name_by_id(self):
        schema = TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="uid", name="user_id", type="string"),
                ColumnSpec(id="em", name="email", type="string"),
            ],
        )
        assert schema_column_name_by_id(schema) == {"uid": "user_id", "em": "email"}

    def test_id_by_name(self):
        schema = TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[
                ColumnSpec(id="uid", name="user_id", type="string"),
                ColumnSpec(id="em", name="email", type="string"),
            ],
        )
        assert schema_column_id_by_name(schema) == {"user_id": "uid", "email": "em"}

    def test_empty_columns(self):
        schema = TableSchemaFile(version=2, id="empty", name="empty")
        assert schema_column_name_by_id(schema) == {}
        assert schema_column_id_by_name(schema) == {}


class TestLoadSchema:
    def test_load_valid_schema(self, tmp_path):
        schema_file = tmp_path / "users.schema.yaml"
        schema_file.write_text("""
version: 2
id: users
name: users
columns:
  - id: email
    name: email
    type: string
""")
        result = load_schema(schema_file)
        assert result.id == "users"
        assert result.name == "users"
        assert len(result.columns) == 1
        assert result.columns[0].name == "email"

    def test_load_invalid_schema_raises(self, tmp_path):
        schema_file = tmp_path / "bad.schema.yaml"
        schema_file.write_text("version: not_a_number\n")
        with pytest.raises(ValueError, match="schema 校验失败"):
            load_schema(schema_file)


class TestBuildRuntimeSchema:
    def test_with_source(self):
        schema_file = TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[ColumnSpec(id="age", name="age", type="integer")],
            source={"mode": "relative_file", "path": "data/users.xlsx", "sheet": "Sheet1", "header_row": 1},
        )
        result = build_runtime_schema(schema_file, {})
        assert result.name == "users"
        assert result.source_file == "data/users.xlsx"
        assert result.sheet_name == "Sheet1"
        assert result.header_row == 1
        assert len(result.columns) == 1

    def test_without_source(self):
        schema_file = TableSchemaFile(
            version=2,
            id="users",
            name="users",
            columns=[ColumnSpec(id="name", name="name", type="string")],
        )
        result = build_runtime_schema(schema_file, {})
        assert result.source_file is None
        assert result.sheet_name is None

    def test_without_source_with_hyphen_id(self):
        """旧版从 ID 解码 sheet 的逻辑已移除，无 source 时 sheet_name 保持 None"""
        schema_file = TableSchemaFile(
            version=2,
            id="users-Sheet1",
            name="users",
            columns=[ColumnSpec(id="name", name="name", type="string")],
        )
        result = build_runtime_schema(schema_file, {})
        assert result.sheet_name is None
