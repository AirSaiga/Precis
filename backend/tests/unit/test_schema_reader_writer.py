"""
@fileoverview Schema 读写模块单元测试

测试 load_schema, save_schema, ensure_schema_file, schema_column_name_by_id, schema_column_id_by_name。
"""

import os
import sys
import tempfile

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


from app.shared.core.project.schema.reader import load_schema, schema_column_id_by_name, schema_column_name_by_id
from app.shared.core.project.schema.types_parts.table import TableSchemaFile
from app.shared.core.project.schema.writer import ensure_schema_file, save_schema


class TestLoadSchema:
    def test_load_valid_schema(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".schema.yaml", delete=False, encoding="utf-8") as f:
            f.write("""
version: 2
id: users
name: users
source:
  mode: relative_file
  path: data/users.xlsx
  sheet: Sheet1
  header_row: 0
columns:
  - id: user_id
    name: user_id
    type: string
    primary_key: true
""")
            path = f.name
        try:
            s = load_schema(path)
            assert isinstance(s, TableSchemaFile)
            assert s.id == "users"
            assert len(s.columns) == 1
            assert s.columns[0].name == "user_id"
        finally:
            os.unlink(path)


class TestSaveSchema:
    def test_save_schema_creates_file(self):
        schema = TableSchemaFile(id="orders", name="orders")
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "orders.schema.yaml")
            save_schema(schema, path)
            assert os.path.exists(path)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            assert "orders" in content


class TestEnsureSchemaFile:
    def test_ensure_existing(self):
        existing = TableSchemaFile(id="users", name="Users")
        files = {"users": existing}
        result = ensure_schema_file(files, "users", "Users")
        assert result is existing

    def test_ensure_new(self):
        files = {}
        result = ensure_schema_file(files, "products", "Products", columns=[{"name": "id", "type": "string"}])
        assert result.id == "products"
        assert len(result.columns) == 1
        assert "products" in files


class TestColumnMappings:
    def test_schema_column_name_by_id(self):
        schema = TableSchemaFile(
            id="t",
            name="T",
            columns=[
                {"id": "col_1", "name": "email", "type": "string"},
                {"id": "col_2", "name": "age", "type": "integer"},
            ],
        )
        mapping = schema_column_name_by_id(schema)
        assert mapping == {"col_1": "email", "col_2": "age"}

    def test_schema_column_id_by_name(self):
        schema = TableSchemaFile(
            id="t",
            name="T",
            columns=[
                {"id": "col_1", "name": "email", "type": "string"},
                {"id": "col_2", "name": "age", "type": "integer"},
            ],
        )
        mapping = schema_column_id_by_name(schema)
        assert mapping == {"email": "col_1", "age": "col_2"}
