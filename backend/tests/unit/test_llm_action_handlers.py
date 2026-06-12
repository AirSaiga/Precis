"""
@fileoverview LLM 动作处理器单元测试 (T17)

覆盖 action_handlers、schema_handlers、regex_handlers、
transform_handlers、settings_handlers 的核心函数。
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from app.shared.services.llm.actions.action_handlers import update_yaml_config
from app.shared.services.llm.actions.regex_handlers import (
    _sanitize_resource_id as regex_sanitize,
)
from app.shared.services.llm.actions.regex_handlers import (
    process_regex_action,
)
from app.shared.services.llm.actions.schema_handlers import (
    process_schema_action,
)
from app.shared.services.llm.actions.settings_handlers import (
    _validate_settings,
    process_settings_action,
)
from app.shared.services.llm.actions.transform_handlers import (
    _sanitize_resource_id as transform_sanitize,
)
from app.shared.services.llm.actions.transform_handlers import (
    process_transform_action,
)

# ============================================================
# action_handlers.py — update_yaml_config
# ============================================================


class TestUpdateYamlConfig:
    """测试 update_yaml_config 的各种场景"""

    def test_invalid_spec_missing_type_and_column(self, tmp_path):
        workspace = str(tmp_path)
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {"type": "", "tableName": "", "targetColumn": ""},
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is False
        assert "无效" in msg

    def test_invalid_spec_no_type(self, tmp_path):
        workspace = str(tmp_path)
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {"type": "", "targetColumn": "email"},
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is False
        assert "无效" in msg

    def test_invalid_spec_no_column(self, tmp_path):
        workspace = str(tmp_path)
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {"type": "NotNull", "targetColumn": ""},
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is False
        assert "无效" in msg

    def test_inline_constraint_no_schema_file(self, tmp_path):
        workspace = str(tmp_path)
        os.makedirs(os.path.join(workspace, "schemas"))
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "NotNull",
                "targetColumn": "email",
                "tableName": "unknown_table",
                "targetNodeId": "sc_unknown",
                "isInline": True,
            },
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is True
        assert msg.startswith("inline:")

    def test_inline_constraint_with_matching_schema(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)

        import yaml

        schema_data = {
            "version": 2,
            "id": "sc_users",
            "name": "users",
            "columns": [
                {"id": "sc_email", "name": "email", "type": "string"},
                {"id": "sc_name", "name": "name", "type": "string"},
            ],
        }
        schema_file = os.path.join(schemas_dir, "sc_users.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "NotNull",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
                "targetColumnId": "sc_email",
                "isInline": True,
            },
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is True
        assert msg.startswith("inline:")

        with open(schema_file, encoding="utf-8") as f:
            result_data = yaml.safe_load(f)
        assert "constraints" in result_data
        assert len(result_data["constraints"]) == 1
        assert result_data["constraints"][0]["type"] == "NotNull"

    def test_inline_constraint_update_existing(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)

        import yaml

        schema_data = {
            "version": 2,
            "id": "sc_users",
            "name": "users",
            "columns": [
                {"id": "sc_email", "name": "email", "type": "string"},
            ],
            "constraints": [{"id": "notnull_users_email", "column": "sc_email", "type": "NotNull"}],
        }
        schema_file = os.path.join(schemas_dir, "sc_users.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        action = {
            "actionType": "UPDATE_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "NotNull",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
                "targetColumnId": "sc_email",
                "isInline": True,
            },
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is True
        assert msg.startswith("inline:")

    @patch("app.shared.services.llm.actions.action_handlers.delete_constraint_file")
    def test_delete_action_delegates(self, mock_delete, tmp_path):
        mock_delete.return_value = (True, "deleted_id")
        workspace = str(tmp_path)
        action = {
            "actionType": "DeleteConstraint",
            "constraintSpec": {
                "type": "NotNull",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
            },
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is True
        assert msg == "deleted_id"
        mock_delete.assert_called_once()

    def test_delete_action_inline_falls_through(self, tmp_path):
        workspace = str(tmp_path)
        os.makedirs(os.path.join(workspace, "schemas"))

        import yaml

        schema_data = {
            "version": 2,
            "id": "sc_users",
            "name": "users",
            "columns": [
                {"id": "sc_email", "name": "email", "type": "string"},
            ],
        }
        schema_file = os.path.join(workspace, "schemas", "sc_users.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        action = {
            "actionType": "DeleteConstraint",
            "constraintSpec": {
                "type": "NotNull",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
                "isInline": False,
            },
        }
        success, msg = update_yaml_config(action, workspace)
        # delete_constraint_file is called but the file doesn't exist
        assert success is False or "不存在" in msg

    @patch("app.shared.services.llm.actions.action_handlers._build_constraint_refs")
    @patch("app.shared.services.llm.actions.action_handlers.save_constraint")
    def test_standalone_constraint_creates_file(self, mock_save, mock_refs, tmp_path):
        mock_save.return_value = None
        mock_refs.return_value = {"table_id": "sc_users", "column_id": "sc_email"}
        workspace = str(tmp_path)
        os.makedirs(os.path.join(workspace, "constraints"))
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Unique",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
                "targetColumnId": "sc_email",
                "isInline": False,
            },
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is True
        assert "unique" in msg.lower()
        mock_save.assert_called_once()

    @patch("app.shared.services.llm.actions.action_handlers._build_constraint_refs")
    @patch("app.shared.services.llm.actions.action_handlers.save_constraint")
    def test_standalone_constraint_save_failure(self, mock_save, mock_refs, tmp_path):
        mock_save.side_effect = OSError("磁盘已满")
        mock_refs.return_value = {"table_id": "sc_users", "column_id": "sc_email"}
        workspace = str(tmp_path)
        os.makedirs(os.path.join(workspace, "constraints"))
        action = {
            "actionType": "ADD_CONSTRAINT_NODE",
            "constraintSpec": {
                "type": "Unique",
                "targetColumn": "email",
                "tableName": "users",
                "targetNodeId": "sc_users",
                "isInline": False,
            },
        }
        success, msg = update_yaml_config(action, workspace)
        assert success is False
        assert "失败" in msg


# ============================================================
# schema_handlers.py
# ============================================================


class TestProcessSchemaAction:
    """测试 process_schema_action 的分发和核心逻辑"""

    def test_unknown_action_type(self, tmp_path):
        result = process_schema_action({"actionType": "UNKNOWN_ACTION", "schemaSpec": {}}, str(tmp_path))
        assert result["success"] is False
        assert "未知" in result["message"]

    def test_add_schema_empty_name(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"name": "", "columns": []},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "名称不能为空" in result["message"]

    def test_add_schema_traversal_id(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"name": "test", "schemaId": "../etc/passwd"},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "非法" in result["message"]

    def test_add_schema_success(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        with open(manifest_path, "w") as f:
            import yaml

            yaml.safe_dump({"version": 2, "project": {"id": "p1"}, "schemas": []}, f)

        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "my_table",
                    "schemaId": "my_table",
                    "columns": [
                        {"name": "col1", "type": "integer"},
                        {"name": "col2", "type": "string"},
                    ],
                },
            },
            workspace,
        )
        assert result["success"] is True
        assert result["message"] == "my_table"

        schema_file = os.path.join(workspace, "schemas", "my_table.schema.yaml")
        assert os.path.isfile(schema_file)

    def test_add_schema_with_invalid_column_type_fallback(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        with open(manifest_path, "w") as f:
            import yaml

            yaml.safe_dump({"version": 2, "project": {"id": "p1"}, "schemas": []}, f)

        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "test_fallback",
                    "schemaId": "test_fallback",
                    "columns": [{"name": "col1", "type": "unknown_type"}],
                },
            },
            workspace,
        )
        assert result["success"] is True
        schema_file = os.path.join(workspace, "schemas", "test_fallback.schema.yaml")
        import yaml

        with open(schema_file, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["columns"][0]["type"] == "string"

    def test_add_schema_rejects_traversal_source_path(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {
                    "name": "test",
                    "schemaId": "test_ts",
                    "source": {"path": "../etc/hosts"},
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "穿越" in result["message"] or "绝对路径" in result["message"]

    def test_add_schema_already_exists(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)
        schema_file = os.path.join(schemas_dir, "existing.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            f.write("version: 2\nid: existing\nname: existing\ncolumns: []\n")

        result = process_schema_action(
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"name": "existing", "schemaId": "existing"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "已存在" in result["message"]

    def test_update_schema_missing_id(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"name": "", "schemaId": ""},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "缺少" in result["message"]

    def test_update_schema_file_not_found(self, tmp_path):
        workspace = str(tmp_path)
        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"schemaId": "nonexistent", "name": "nonexistent"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "不存在" in result["message"]

    def test_update_schema_traversal_id(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"schemaId": "../etc/passwd"},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "非法" in result["message"]

    def test_update_schema_success(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)
        import yaml

        schema_data = {
            "version": 2,
            "id": "test_update",
            "name": "test_update",
            "columns": [{"id": "sc_c1", "name": "c1", "type": "string"}],
        }
        schema_file = os.path.join(schemas_dir, "test_update.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {
                    "schemaId": "test_update",
                    "columns": [{"name": "c1", "type": "integer"}],
                },
            },
            workspace,
        )
        assert result["success"] is True

        with open(schema_file, encoding="utf-8") as f:
            updated = yaml.safe_load(f)
        assert updated["columns"][0]["type"] == "integer"

    def test_update_schema_with_new_column(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)
        import yaml

        schema_data = {
            "version": 2,
            "id": "test_newcol",
            "name": "test_newcol",
            "columns": [{"id": "sc_c1", "name": "c1", "type": "string"}],
        }
        schema_file = os.path.join(schemas_dir, "test_newcol.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {
                    "schemaId": "test_newcol",
                    "columns": [
                        {"name": "c1", "type": "string"},
                        {"name": "c2", "type": "boolean"},
                    ],
                },
            },
            workspace,
        )
        assert result["success"] is True

        with open(schema_file, encoding="utf-8") as f:
            updated = yaml.safe_load(f)
        assert len(updated["columns"]) == 2
        names = {c["name"] for c in updated["columns"]}
        assert names == {"c1", "c2"}

    def test_update_schema_rejects_traversal_source(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)
        import yaml

        schema_data = {
            "version": 2,
            "id": "test_src",
            "name": "test_src",
            "columns": [],
        }
        schema_file = os.path.join(schemas_dir, "test_src.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        result = process_schema_action(
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {
                    "schemaId": "test_src",
                    "source": {"path": "../../etc/hosts"},
                },
            },
            workspace,
        )
        assert result["success"] is False
        assert "穿越" in result["message"] or "绝对路径" in result["message"]

    def test_delete_schema_success(self, tmp_path):
        workspace = str(tmp_path)
        schemas_dir = os.path.join(workspace, "schemas")
        os.makedirs(schemas_dir)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        schema_data = {
            "version": 2,
            "id": "to_delete",
            "name": "to_delete",
            "columns": [],
        }
        schema_file = os.path.join(schemas_dir, "to_delete.schema.yaml")
        with open(schema_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(schema_data, f)

        manifest_data = {
            "version": 2,
            "project": {"id": "p1"},
            "schemas": [{"id": "to_delete", "file": "schemas/to_delete.schema.yaml"}],
        }
        with open(manifest_path, "w") as f:
            yaml.safe_dump(manifest_data, f)

        result = process_schema_action(
            {
                "actionType": "DELETE_SCHEMA",
                "schemaSpec": {"schemaId": "to_delete"},
            },
            workspace,
        )
        assert result["success"] is True
        assert not os.path.isfile(schema_file)

    def test_delete_schema_not_found(self, tmp_path):
        workspace = str(tmp_path)
        result = process_schema_action(
            {
                "actionType": "DELETE_SCHEMA",
                "schemaSpec": {"schemaId": "nonexistent"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "不存在" in result["message"]

    def test_delete_schema_missing_id(self, tmp_path):
        result = process_schema_action(
            {
                "actionType": "DELETE_SCHEMA",
                "schemaSpec": {"schemaId": "", "name": ""},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "缺少" in result["message"]


# ============================================================
# regex_handlers.py
# ============================================================


class TestProcessRegexAction:
    """测试 process_regex_action 的分发和核心逻辑"""

    def test_unknown_action_type(self, tmp_path):
        result = process_regex_action({"actionType": "UNKNOWN_REGEX_ACTION", "regexSpec": {}}, str(tmp_path))
        assert result["success"] is False
        assert "未知" in result["message"]

    def test_add_regex_empty_name(self, tmp_path):
        result = process_regex_action(
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"name": "", "pattern": ".*"},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "名称不能为空" in result["message"]

    def test_add_regex_empty_pattern(self, tmp_path):
        result = process_regex_action(
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"name": "test_regex", "pattern": ""},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "模式不能为空" in result["message"]

    def test_add_regex_success(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        with open(manifest_path, "w") as f:
            yaml.safe_dump({"version": 2, "project": {"id": "p1"}, "regex_nodes": []}, f)

        result = process_regex_action(
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {
                    "name": "email_regex",
                    "regexId": "email_regex",
                    "pattern": r"^[a-z]+@[a-z]+\.[a-z]+$",
                    "matchMode": "full",
                    "caseSensitive": False,
                    "targetNodeId": "sc_users",
                    "targetColumn": "email",
                },
            },
            workspace,
        )
        assert result["success"] is True
        assert result["message"] == "email_regex"

        regex_file = os.path.join(workspace, "regex_nodes", "email_regex.regex.yaml")
        assert os.path.isfile(regex_file)

    def test_add_regex_traversal_id(self, tmp_path):
        result = process_regex_action(
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"name": "test", "regexId": "../etc/hosts", "pattern": ".*"},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "非法" in result["message"]

    def test_add_regex_invalid_match_mode(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        with open(manifest_path, "w") as f:
            yaml.safe_dump({"version": 2, "project": {"id": "p1"}, "regex_nodes": []}, f)

        result = process_regex_action(
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {
                    "name": "test_regex",
                    "regexId": "test_regex",
                    "pattern": ".*",
                    "matchMode": "invalid_mode",
                },
            },
            workspace,
        )
        assert result["success"] is True
        regex_file = os.path.join(workspace, "regex_nodes", "test_regex.regex.yaml")
        with open(regex_file, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["match_mode"] == "full"

    def test_add_regex_already_exists(self, tmp_path):
        workspace = str(tmp_path)
        regex_dir = os.path.join(workspace, "regex_nodes")
        os.makedirs(regex_dir)
        regex_file = os.path.join(regex_dir, "exists.regex.yaml")
        with open(regex_file, "w", encoding="utf-8") as f:
            f.write("version: 2\n")

        result = process_regex_action(
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"name": "exists", "regexId": "exists", "pattern": ".*"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "已存在" in result["message"]

    def test_update_regex_success(self, tmp_path):
        workspace = str(tmp_path)
        regex_dir = os.path.join(workspace, "regex_nodes")
        os.makedirs(regex_dir)
        import yaml

        data = {
            "version": 2,
            "id": "update_test",
            "name": "old_name",
            "pattern": "old_pattern",
            "match_mode": "full",
            "case_sensitive": False,
            "enabled": True,
        }
        regex_file = os.path.join(regex_dir, "update_test.regex.yaml")
        with open(regex_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f)

        result = process_regex_action(
            {
                "actionType": "UPDATE_REGEX",
                "regexSpec": {
                    "regexId": "update_test",
                    "pattern": "new_pattern",
                    "name": "new_name",
                    "matchMode": "extract",
                    "caseSensitive": True,
                },
            },
            workspace,
        )
        assert result["success"] is True

        with open(regex_file, encoding="utf-8") as f:
            updated = yaml.safe_load(f)
        assert updated["pattern"] == "new_pattern"
        assert updated["name"] == "new_name"
        assert updated["match_mode"] == "extract"
        assert updated["case_sensitive"] is True

    def test_update_regex_not_found(self, tmp_path):
        workspace = str(tmp_path)
        result = process_regex_action(
            {
                "actionType": "UPDATE_REGEX",
                "regexSpec": {"regexId": "nonexistent"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "不存在" in result["message"]

    def test_update_regex_missing_id(self, tmp_path):
        result = process_regex_action(
            {
                "actionType": "UPDATE_REGEX",
                "regexSpec": {"regexId": "", "name": ""},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "缺少" in result["message"]

    def test_delete_regex_success(self, tmp_path):
        workspace = str(tmp_path)
        regex_dir = os.path.join(workspace, "regex_nodes")
        os.makedirs(regex_dir)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        regex_file = os.path.join(regex_dir, "to_delete.regex.yaml")
        with open(regex_file, "w", encoding="utf-8") as f:
            yaml.safe_dump({"version": 2, "id": "to_delete", "name": "to_delete"}, f)

        manifest_data = {
            "version": 2,
            "project": {"id": "p1"},
            "regex_nodes": [{"id": "to_delete", "file": "regex_nodes/to_delete.regex.yaml"}],
        }
        with open(manifest_path, "w") as f:
            yaml.safe_dump(manifest_data, f)

        result = process_regex_action(
            {
                "actionType": "DELETE_REGEX",
                "regexSpec": {"regexId": "to_delete"},
            },
            workspace,
        )
        assert result["success"] is True
        assert not os.path.isfile(regex_file)

    def test_delete_regex_not_found(self, tmp_path):
        workspace = str(tmp_path)
        result = process_regex_action(
            {
                "actionType": "DELETE_REGEX",
                "regexSpec": {"regexId": "nonexistent"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "不存在" in result["message"]


# ============================================================
# transform_handlers.py
# ============================================================


class TestProcessTransformAction:
    """测试 process_transform_action 的分发和核心逻辑"""

    def test_unknown_action_type(self, tmp_path):
        result = process_transform_action({"actionType": "UNKNOWN_TRANSFORM", "transformSpec": {}}, str(tmp_path))
        assert result["success"] is False
        assert "未知" in result["message"]

    def test_add_transform_empty_type(self, tmp_path):
        result = process_transform_action(
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"type": ""},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "类型不能为空" in result["message"]

    def test_add_transform_invalid_type(self, tmp_path):
        result = process_transform_action(
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"type": "InvalidType"},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "不支持" in result["message"]

    def test_add_transform_success(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        with open(manifest_path, "w") as f:
            yaml.safe_dump({"version": 2, "project": {"id": "p1"}, "transforms": []}, f)

        result = process_transform_action(
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {
                    "type": "UpperCase",
                    "transformId": "my_transform",
                    "inputFromNode": "sc_users",
                    "inputColumn": "name",
                    "params": {},
                    "outputColumns": ["name_upper"],
                },
            },
            workspace,
        )
        assert result["success"] is True

        tf_dir = os.path.join(workspace, "transforms")
        assert os.path.isdir(tf_dir)
        tf_file = os.path.join(tf_dir, "my_transform.transform.yaml")
        assert os.path.isfile(tf_file)

    def test_add_transform_traversal_id(self, tmp_path):
        result = process_transform_action(
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"type": "UpperCase", "transformId": "../etc/hosts"},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "非法" in result["message"]

    def test_add_transform_already_exists(self, tmp_path):
        workspace = str(tmp_path)
        tf_dir = os.path.join(workspace, "transforms")
        os.makedirs(tf_dir)
        tf_file = os.path.join(tf_dir, "exists.transform.yaml")
        with open(tf_file, "w", encoding="utf-8") as f:
            f.write("version: 2\n")

        result = process_transform_action(
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"type": "UpperCase", "transformId": "exists"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "已存在" in result["message"]

    def test_add_transform_no_id_uses_auto_generated(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        with open(manifest_path, "w") as f:
            yaml.safe_dump({"version": 2, "project": {"id": "p1"}, "transforms": []}, f)

        result = process_transform_action(
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"type": "LowerCase"},
            },
            workspace,
        )
        assert result["success"] is True

    def test_update_transform_success(self, tmp_path):
        workspace = str(tmp_path)
        tf_dir = os.path.join(workspace, "transforms")
        os.makedirs(tf_dir)
        import yaml

        data = {
            "version": 2,
            "id": "tf1",
            "type": "UpperCase",
            "params": {},
        }
        tf_file = os.path.join(tf_dir, "tf1.transform.yaml")
        with open(tf_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f)

        result = process_transform_action(
            {
                "actionType": "UPDATE_TRANSFORM",
                "transformSpec": {
                    "transformId": "tf1",
                    "type": "LowerCase",
                    "description": "updated desc",
                    "params": {"key": "value"},
                },
            },
            workspace,
        )
        assert result["success"] is True

        with open(tf_file, encoding="utf-8") as f:
            updated = yaml.safe_load(f)
        assert updated["type"] == "LowerCase"
        assert updated["description"] == "updated desc"
        assert updated["params"] == {"key": "value"}

    def test_update_transform_not_found(self, tmp_path):
        workspace = str(tmp_path)
        result = process_transform_action(
            {
                "actionType": "UPDATE_TRANSFORM",
                "transformSpec": {"transformId": "nonexistent"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "不存在" in result["message"]

    def test_update_transform_missing_id(self, tmp_path):
        result = process_transform_action(
            {
                "actionType": "UPDATE_TRANSFORM",
                "transformSpec": {"transformId": "", "id": ""},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "缺少" in result["message"]

    def test_delete_transform_success(self, tmp_path):
        workspace = str(tmp_path)
        tf_dir = os.path.join(workspace, "transforms")
        os.makedirs(tf_dir)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        tf_file = os.path.join(tf_dir, "to_delete.transform.yaml")
        with open(tf_file, "w", encoding="utf-8") as f:
            yaml.safe_dump({"version": 2, "id": "to_delete", "type": "UpperCase"}, f)

        manifest_data = {
            "version": 2,
            "project": {"id": "p1"},
            "transforms": [{"id": "to_delete", "path": "transforms/to_delete.transform.yaml"}],
        }
        with open(manifest_path, "w") as f:
            yaml.safe_dump(manifest_data, f)

        result = process_transform_action(
            {
                "actionType": "DELETE_TRANSFORM",
                "transformSpec": {"transformId": "to_delete"},
            },
            workspace,
        )
        assert result["success"] is True
        assert not os.path.isfile(tf_file)

    def test_delete_transform_not_found(self, tmp_path):
        workspace = str(tmp_path)
        result = process_transform_action(
            {
                "actionType": "DELETE_TRANSFORM",
                "transformSpec": {"transformId": "nonexistent"},
            },
            workspace,
        )
        assert result["success"] is False
        assert "不存在" in result["message"]


# ============================================================
# settings_handlers.py
# ============================================================


class TestValidateSettings:
    """测试 _validate_settings"""

    def test_valid_validation_settings(self):
        errors = _validate_settings(
            "validation",
            {"error_handling": "stop", "timeout_seconds": 30, "batch_max_files": 10},
        )
        assert errors == []

    def test_invalid_error_handling(self):
        errors = _validate_settings("validation", {"error_handling": "invalid"})
        assert len(errors) == 1
        assert "error_handling" in errors[0]

    def test_invalid_timeout_seconds_negative(self):
        errors = _validate_settings("validation", {"timeout_seconds": -1})
        assert len(errors) == 1
        assert "timeout_seconds" in errors[0]

    def test_invalid_timeout_seconds_zero(self):
        errors = _validate_settings("validation", {"timeout_seconds": 0})
        assert len(errors) == 1
        assert "正数" in errors[0]

    def test_invalid_timeout_seconds_str(self):
        errors = _validate_settings("validation", {"timeout_seconds": "abc"})
        assert len(errors) >= 1

    def test_invalid_batch_max_files(self):
        errors = _validate_settings("validation", {"batch_max_files": 0})
        assert len(errors) == 1
        assert "batch_max_files" in errors[0]

    def test_invalid_batch_max_files_str(self):
        errors = _validate_settings("validation", {"batch_max_files": "abc"})
        assert len(errors) >= 1

    def test_valid_file_processing_settings(self):
        errors = _validate_settings("fileProcessing", {"default_encoding": "utf-8", "csv_delimiter": ","})
        assert errors == []

    def test_invalid_encoding(self):
        errors = _validate_settings("fileProcessing", {"default_encoding": "latin1"})
        assert len(errors) == 1
        assert "default_encoding" in errors[0]

    def test_invalid_csv_delimiter_multichar(self):
        errors = _validate_settings("fileProcessing", {"csv_delimiter": ";;"})
        assert len(errors) == 1
        assert "csv_delimiter" in errors[0]

    def test_invalid_csv_delimiter_not_string(self):
        errors = _validate_settings("fileProcessing", {"csv_delimiter": 1})
        assert len(errors) >= 1

    def test_valid_script_security(self):
        errors = _validate_settings("scriptSecurity", {"timeout_seconds": 10, "sandbox_mode": "strict"})
        assert errors == []

    def test_invalid_allow_eval(self):
        errors = _validate_settings("scriptSecurity", {"allow_eval": True})
        assert len(errors) == 1
        assert "allow_eval" in errors[0]

    def test_invalid_sandbox_mode(self):
        errors = _validate_settings("scriptSecurity", {"sandbox_mode": "unsafe"})
        assert len(errors) == 1
        assert "sandbox_mode" in errors[0]

    def test_invalid_script_security_timeout(self):
        errors = _validate_settings("scriptSecurity", {"timeout_seconds": 0})
        assert len(errors) >= 1

    def test_multiple_errors(self):
        errors = _validate_settings(
            "validation",
            {"error_handling": "bad", "timeout_seconds": -5, "batch_max_files": 0},
        )
        assert len(errors) >= 3


class TestProcessSettingsAction:
    """测试 process_settings_action"""

    def test_missing_category(self, tmp_path):
        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "", "settings": {"key": "value"}},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "缺少" in result["message"]

    def test_invalid_category(self, tmp_path):
        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "invalidCat", "settings": {"key": "value"}},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "未知" in result["message"]

    def test_empty_settings(self, tmp_path):
        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "validation", "settings": {}},
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "不能为空" in result["message"]

    def test_validation_failure(self, tmp_path):
        manifest_path = os.path.join(str(tmp_path), "project.precis.yaml")
        import yaml

        with open(manifest_path, "w") as f:
            yaml.safe_dump({"version": 2, "project": {"id": "p1"}}, f)

        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {
                    "category": "validation",
                    "settings": {"error_handling": "invalid"},
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "校验失败" in result["message"]

    def test_manifest_not_found(self, tmp_path):
        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {
                    "category": "validation",
                    "settings": {"error_handling": "stop"},
                },
            },
            str(tmp_path),
        )
        assert result["success"] is False
        assert "不存在" in result["message"]

    def test_successful_settings_update(self, tmp_path):
        workspace = str(tmp_path)
        manifest_path = os.path.join(workspace, "project.precis.yaml")
        import yaml

        with open(manifest_path, "w") as f:
            yaml.safe_dump({"version": 2, "project": {"id": "p1"}}, f)

        result = process_settings_action(
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {
                    "category": "validation",
                    "settings": {"error_handling": "continue", "timeout_seconds": 60},
                },
            },
            workspace,
        )
        assert result["success"] is True
        assert result["message"] == "settings.validation"

        with open(manifest_path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["settings"]["validation"]["error_handling"] == "continue"
        assert data["settings"]["validation"]["timeout_seconds"] == 60


# ============================================================
# _sanitize_resource_id (regex, transform)
# ============================================================


class TestRegexSanitize:
    """测试 regex_handlers._sanitize_resource_id"""

    def test_normal_id(self):
        assert regex_sanitize("my_regex") == "my_regex"

    def test_traversal_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            regex_sanitize("../etc/hosts")


class TestTransformSanitize:
    """测试 transform_handlers._sanitize_resource_id"""

    def test_normal_id(self):
        assert transform_sanitize("my_transform") == "my_transform"

    def test_backslash_rejected(self):
        with pytest.raises(ValueError, match="非法"):
            transform_sanitize("foo\\bar")
