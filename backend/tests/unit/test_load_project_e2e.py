"""
@fileoverview load_project 端到端单元测试

在临时目录中构建完整项目结构并测试加载流程。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.project.loader.loader_parts.main import load_project


class TestLoadProject:
    def test_full_project(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
constraints:
  - id: notnull_name
    path: constraints/notnull_name.constraint.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "users.schema.yaml").write_text(
            """
version: 2
id: users
name: users
source:
  mode: relative_file
  path: data/users.xlsx
  sheet: Sheet1
columns:
  - id: user_id
    name: user_id
    type: string
    primary_key: true
  - id: name
    name: name
    type: string
    nullable: false
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "notnull_name.constraint.yaml").write_text(
            """
version: 2
id: notnull_name
type: NotNull
enabled: true
refs:
  table_id: users
  column_id: name
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert result.manifest.project.id == "test-project"
        assert "users" in result.schema_files
        assert result.schema_files["users"].name == "users"
        assert "notnull_name" in result.constraint_files
        assert result.dataset_schema is not None
        assert len(result.loading_errors) == 0

    def test_missing_schema(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/missing.schema.yaml
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert "users" not in result.schema_files
        assert any(e.error_type == "SchemaNotFound" for e in result.loading_errors)
        assert len(result.warnings) > 0

    def test_invalid_schema(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/bad.schema.yaml
""",
            encoding="utf-8",
        )

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        (schemas_dir / "bad.schema.yaml").write_text("not: valid: yaml: [", encoding="utf-8")

        result = load_project(str(manifest))
        assert "users" not in result.schema_files
        assert any(e.error_type == "SchemaParseError" for e in result.loading_errors)

    def test_unsupported_version(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 99
project:
  id: test-project
  name: Test Project
""",
            encoding="utf-8",
        )

        with pytest.raises(ValueError) as exc_info:
            load_project(str(manifest))
        assert "不支持" in str(exc_info.value)

    def test_missing_constraint(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
constraints:
  - id: missing
    path: constraints/missing.constraint.yaml
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert "missing" not in result.constraint_files
        assert any(e.error_type == "ConstraintNotFound" for e in result.loading_errors)

    def test_invalid_constraint(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
constraints:
  - id: bad
    path: constraints/bad.constraint.yaml
""",
            encoding="utf-8",
        )

        constraints_dir = tmp_path / "constraints"
        constraints_dir.mkdir()
        (constraints_dir / "bad.constraint.yaml").write_text("not: valid: yaml: [", encoding="utf-8")

        result = load_project(str(manifest))
        assert "bad" not in result.constraint_files
        assert any(e.error_type == "ConstraintParseError" for e in result.loading_errors)

    def test_missing_regex(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
regex_nodes:
  - id: missing
    path: regex/missing.regex.yaml
""",
            encoding="utf-8",
        )

        result = load_project(str(manifest))
        assert "missing" not in result.regex_node_files
        assert any(e.error_type == "RegexNotFound" for e in result.loading_errors)

    def test_invalid_regex(self, tmp_path):
        manifest = tmp_path / "project.precis.yaml"
        manifest.write_text(
            """
version: 2
project:
  id: test-project
  name: Test Project
regex_nodes:
  - id: bad
    path: regex/bad.regex.yaml
""",
            encoding="utf-8",
        )

        regex_dir = tmp_path / "regex"
        regex_dir.mkdir()
        (regex_dir / "bad.regex.yaml").write_text("not: valid: yaml: [", encoding="utf-8")

        result = load_project(str(manifest))
        assert "bad" not in result.regex_node_files
        assert any(e.error_type == "RegexParseError" for e in result.loading_errors)
