"""
@fileoverview LLM 动作处理器安全路径验证测试

测试 _collect_affected_files 中的路径穿越防护和 _sanitize_id 清洗逻辑，
以及 schema_handlers 中的 _sanitize_resource_id 和 source.path 校验。
"""

from __future__ import annotations

import os

import pytest

from app.shared.services.llm.actions.action_processor import _collect_affected_files
from app.shared.services.llm.actions.schema_handlers import (
    _sanitize_resource_id,
    process_schema_action,
)


class TestCollectAffectedFiles:
    """测试 _collect_affected_files 的路径安全逻辑"""

    def test_normal_constraint_file(self, tmp_path):
        workspace = str(tmp_path)
        constraint_file = str(tmp_path / "constraints" / "c1.constraint.yaml")
        os.makedirs(os.path.dirname(constraint_file), exist_ok=True)
        with open(constraint_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"constraintFile": constraint_file},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert constraint_file in result

    def test_path_traversal_constraint_file_rejected(self, tmp_path):
        workspace = str(tmp_path)
        actions = [
            {
                "actionType": "UPDATE_CONSTRAINT_NODE",
                "constraintSpec": {"constraintFile": "../../etc/passwd"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert len(result) == 0

    def test_absolute_path_outside_workspace_rejected(self, tmp_path):
        workspace = str(tmp_path)
        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"filePath": "/etc/shadow"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert len(result) == 0

    def test_schema_action_with_safe_id(self, tmp_path):
        workspace = str(tmp_path)
        schema_file = str(tmp_path / "schemas" / "my_schema.schema.yaml")
        os.makedirs(os.path.dirname(schema_file), exist_ok=True)
        with open(schema_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"schemaId": "my_schema"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert schema_file in result

    def test_schema_action_with_traversal_id_rejected(self, tmp_path):
        workspace = str(tmp_path)
        actions = [
            {
                "actionType": "DELETE_SCHEMA",
                "schemaSpec": {"schemaId": "../etc/passwd"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert len(result) == 0

    def test_schema_action_with_backslash_id_rejected(self, tmp_path):
        actions = [
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"schemaId": "foo\\bar"},
            }
        ]
        result = _collect_affected_files(actions, str(tmp_path))
        assert len(result) == 0

    def test_regex_action_with_safe_id(self, tmp_path):
        workspace = str(tmp_path)
        regex_file = str(tmp_path / "regex" / "my_regex.regex.yaml")
        os.makedirs(os.path.dirname(regex_file), exist_ok=True)
        with open(regex_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "UPDATE_REGEX",
                "regexSpec": {"regexId": "my_regex"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert regex_file in result

    def test_regex_action_with_traversal_id_rejected(self, tmp_path):
        actions = [
            {
                "actionType": "DELETE_REGEX",
                "regexSpec": {"regexId": "../../../etc/hosts"},
            }
        ]
        result = _collect_affected_files(actions, str(tmp_path))
        assert len(result) == 0

    def test_transform_action_with_traversal_id_rejected(self, tmp_path):
        actions = [
            {
                "actionType": "UPDATE_TRANSFORM",
                "transformSpec": {"transformId": "../etc/config"},
            }
        ]
        result = _collect_affected_files(actions, str(tmp_path))
        assert len(result) == 0

    def test_manifest_always_backed_up_when_file_modifications_exist(self, tmp_path):
        workspace = str(tmp_path)
        manifest = str(tmp_path / "project.precis.yaml")
        with open(manifest, "w") as f:
            f.write("version: 2\n")

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"constraintFile": str(tmp_path / "constraints" / "c.yaml")},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert manifest in result

    def test_empty_actions_returns_empty(self, tmp_path):
        result = _collect_affected_files([], str(tmp_path))
        assert len(result) == 0

    def test_schema_file_inside_workspace_accepted(self, tmp_path):
        workspace = str(tmp_path)
        schema_file = str(tmp_path / "schemas" / "s.yaml")
        os.makedirs(os.path.dirname(schema_file), exist_ok=True)
        with open(schema_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "constraintFile": str(tmp_path / "constraints" / "c.yaml"),
                    "schemaFile": schema_file,
                },
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert schema_file in result


class TestSanitizeResourceId:
    """测试 schema_handlers._sanitize_resource_id"""

    def test_normal_id_passes(self):
        assert _sanitize_resource_id("my_schema") == "my_schema"

    def test_id_with_hyphen_passes(self):
        assert _sanitize_resource_id("my-schema-v2") == "my-schema-v2"

    def test_forward_slash_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            _sanitize_resource_id("foo/bar")

    def test_backslash_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            _sanitize_resource_id("foo\\bar")

    def test_double_dot_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            _sanitize_resource_id("..")

    def test_traversal_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            _sanitize_resource_id("../etc/passwd")


class TestSchemaSourcePathSecurity:
    """测试 ADD_SCHEMA / UPDATE_SCHEMA 的 source.path 安全校验"""

    def test_add_schema_rejects_absolute_source_path(self, tmp_path):
        abs_path = os.path.abspath(os.path.join(str(tmp_path), "..", "..", "etc", "passwd"))
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "test",
                    "schemaId": "test_schema",
                    "source": {"path": abs_path},
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "绝对路径" in result["message"] or "穿越" in result["message"]

    def test_add_schema_rejects_traversal_source_path(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "test",
                    "schemaId": "test_schema",
                    "source": {"path": os.path.join("..", "..", "etc", "shadow")},
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "穿越" in result["message"] or "绝对路径" in result["message"]

    def test_add_schema_accepts_relative_safe_path(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "test_schema",
                    "schemaId": "test_schema",
                    "columns": [{"name": "col1", "type": "string"}],
                    "source": {"path": "data/input.xlsx"},
                },
            },
            str(tmp_path),
        )
        assert result["success"] is True

    def test_add_schema_rejects_traversal_id(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "test",
                    "schemaId": "../etc/passwd",
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "非法" in result["message"]

    def test_update_schema_rejects_absolute_source_path(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        schema_file = schemas_dir / "test.schema.yaml"
        with open(schema_file, "w", encoding="utf-8") as f:
            f.write("version: 2\nid: test\nname: test\ncolumns: []\n")

        manifest = tmp_path / "project.precis.yaml"
        with open(manifest, "w") as f:
            f.write("version: 2\nproject:\n  id: p1\nschemas:\n  - id: test\n  - file: schemas/test.schema.yaml\n")

        abs_path = os.path.abspath(os.path.join(workspace, "..", "..", "etc", "data.csv"))
        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {
                    "schemaId": "test",
                    "source": {"path": abs_path},
                },
            },
            workspace,
        )
        assert result["success"] is False
        assert "绝对路径" in result["message"] or "穿越" in result["message"]

    def test_delete_schema_rejects_traversal_id(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "DELETE_SCHEMA",
                "schemaSpec": {
                    "schemaId": "../etc/passwd",
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "非法" in result["message"]
