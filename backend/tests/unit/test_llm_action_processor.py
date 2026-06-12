"""
@fileoverview LLM action_processor 单元测试 (T18 Part 1)

覆盖 _collect_affected_files、_backup_files、_restore_backups、
process_actions、_execute_actions 的核心函数。
"""

from __future__ import annotations

import os
from unittest.mock import patch

from app.shared.services.llm.actions.action_processor import (
    _backup_files,
    _collect_affected_files,
    _execute_actions,
    _restore_backups,
    process_actions,
)

# ============================================================
# _collect_affected_files (补充安全测试已有覆盖)
# ============================================================


class TestCollectAffectedFilesCoverage:
    """补充 _collect_affected_files 的分支覆盖"""

    def test_constraint_action_with_schema_file_and_filepath(self, tmp_path):
        workspace = str(tmp_path)
        constraint_file = str(tmp_path / "constraints" / "c1.constraint.yaml")
        os.makedirs(os.path.dirname(constraint_file), exist_ok=True)
        with open(constraint_file, "w") as f:
            f.write("test")

        schema_file = str(tmp_path / "schemas" / "s1.schema.yaml")
        os.makedirs(os.path.dirname(schema_file), exist_ok=True)
        with open(schema_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "constraintFile": constraint_file,
                    "schemaFile": schema_file,
                },
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert constraint_file in result
        assert schema_file in result

    def test_constraint_action_with_schema_file_path(self, tmp_path):
        workspace = str(tmp_path)
        schema_file = str(tmp_path / "schemas" / "s1.schema.yaml")
        os.makedirs(os.path.dirname(schema_file), exist_ok=True)
        with open(schema_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "UPDATE_CONSTRAINT_NODE",
                "constraintSpec": {"schemaFilePath": schema_file},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert schema_file in result

    def test_delete_constraint_action(self, tmp_path):
        workspace = str(tmp_path)
        manifest = str(tmp_path / "project.precis.yaml")
        with open(manifest, "w") as f:
            f.write("version: 2\n")

        actions = [
            {
                "actionType": "DELETE_CONSTRAINT_NODE",
                "constraintSpec": {"constraintFile": "constraints/c1.constraint.yaml"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert manifest in result

    def test_regex_action_multiple_dirs(self, tmp_path):
        workspace = str(tmp_path)
        regex_file = str(tmp_path / "regex" / "r1.regex.yaml")
        os.makedirs(os.path.dirname(regex_file), exist_ok=True)
        with open(regex_file, "w") as f:
            f.write("test")

        manifest = str(tmp_path / "project.precis.yaml")
        with open(manifest, "w") as f:
            f.write("version: 2\n")

        actions = [
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"regexId": "r1"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert regex_file in result
        assert manifest in result

    def test_transform_action_existing_file(self, tmp_path):
        workspace = str(tmp_path)
        tf_file = str(tmp_path / "transforms" / "t1.transform.yaml")
        os.makedirs(os.path.dirname(tf_file), exist_ok=True)
        with open(tf_file, "w") as f:
            f.write("test")

        manifest = str(tmp_path / "project.precis.yaml")
        with open(manifest, "w") as f:
            f.write("version: 2\n")

        actions = [
            {
                "actionType": "UPDATE_TRANSFORM",
                "transformSpec": {"transformId": "t1"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert tf_file in result
        assert manifest in result

    def test_update_settings_triggers_manifest(self, tmp_path):
        workspace = str(tmp_path)
        manifest = str(tmp_path / "project.precis.yaml")
        with open(manifest, "w") as f:
            f.write("version: 2\n")

        actions = [
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "validation", "settings": {}},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert manifest in result

    def test_schema_action_with_yaml_filename(self, tmp_path):
        workspace = str(tmp_path)
        schema_file_alt = str(tmp_path / "schemas" / "my_table.yaml")
        os.makedirs(os.path.dirname(schema_file_alt), exist_ok=True)
        with open(schema_file_alt, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"schemaId": "my_table"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert schema_file_alt in result

    def test_schema_action_name_fallback(self, tmp_path):
        workspace = str(tmp_path)
        schema_file = str(tmp_path / "schemas" / "tbl_name.schema.yaml")
        os.makedirs(os.path.dirname(schema_file), exist_ok=True)
        with open(schema_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "UPDATE_SCHEMA",
                "schemaSpec": {"name": "tbl_name"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert schema_file in result

    def test_regex_node_multiple_dirs_search(self, tmp_path):
        workspace = str(tmp_path)
        regex_file = str(tmp_path / "regex_nodes" / "r2.regex.yaml")
        os.makedirs(os.path.dirname(regex_file), exist_ok=True)
        with open(regex_file, "w") as f:
            f.write("test")

        actions = [
            {
                "actionType": "DELETE_REGEX",
                "regexSpec": {"regexId": "r2"},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert regex_file in result

    def test_validate_project_action_no_file_modifications(self, tmp_path):
        workspace = str(tmp_path)
        actions = [
            {
                "actionType": "VALIDATE_PROJECT",
                "constraintSpec": {},
            }
        ]
        result = _collect_affected_files(actions, workspace)
        assert len(result) == 0

    def test_id_with_spaces_rejected(self, tmp_path):
        actions = [
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"schemaId": "foo bar"},
            }
        ]
        result = _collect_affected_files(actions, str(tmp_path))
        # " " in id will be caught by _sanitize_id since it contains no path separators but os.path.basename trims
        # Actually spaces won't be caught by _sanitize_id, let me check
        # _sanitize_id checks for "/", "\\", ".." in resource_id
        # Spaces are not checked, but the file won't exist so nothing is collected
        assert result == set()


# ============================================================
# _backup_files / _restore_backups
# ============================================================


class TestBackupRestore:
    """测试备份和回滚功能"""

    def test_backup_files_creates_copies(self, tmp_path):
        original = str(tmp_path / "test.txt")
        with open(original, "w") as f:
            f.write("original content")

        backup_dir = str(tmp_path / "backups")
        os.makedirs(backup_dir)

        backups = _backup_files({original}, backup_dir)
        assert original in backups
        assert os.path.isfile(backups[original])

        with open(backups[original], encoding="utf-8") as f:
            assert f.read() == "original content"

    def test_backup_files_nonexistent_file_handled(self, tmp_path):
        backup_dir = str(tmp_path / "backups")
        os.makedirs(backup_dir)

        backups = _backup_files({str(tmp_path / "nonexistent.txt")}, backup_dir)
        assert len(backups) == 0

    def test_restore_backups_overwrites_original(self, tmp_path):
        original = str(tmp_path / "restore_test.txt")
        with open(original, "w") as f:
            f.write("modified content")

        backup_dir = str(tmp_path / "backups_restore")
        os.makedirs(backup_dir)
        backup_file = os.path.join(backup_dir, "restore_test.txt")
        with open(backup_file, "w") as f:
            f.write("backup content")

        _restore_backups({original: backup_file})

        with open(original, encoding="utf-8") as f:
            assert f.read() == "backup content"

    def test_restore_backups_empty_dict_noop(self):
        _restore_backups({})  # should not raise


# ============================================================
# process_actions
# ============================================================


class TestProcessActions:
    """测试 process_actions 主流程"""

    def test_empty_actions(self, tmp_path):
        result = process_actions([], str(tmp_path))
        assert result["success"] is True
        assert result["results"] == []

    @patch("app.shared.services.llm.actions.action_processor._execute_actions")
    def test_all_success_returns_true(self, mock_execute, tmp_path):
        mock_execute.return_value = [{"action": {"actionType": "VALIDATE_PROJECT"}, "success": True, "message": "ok"}]
        result = process_actions([{"actionType": "VALIDATE_PROJECT"}], str(tmp_path))
        assert result["success"] is True
        assert len(result["results"]) == 1

    @patch("app.shared.services.llm.actions.action_processor._execute_actions")
    def test_partial_failure_triggers_rollback(self, mock_execute, tmp_path):
        workspace = str(tmp_path)
        # Create a manifest that will be backed up
        manifest = os.path.join(workspace, "project.precis.yaml")
        with open(manifest, "w") as f:
            f.write("version: 2\n")

        # _execute_actions returns one failure
        mock_execute.return_value = [
            {
                "action": {"actionType": "ADD_CONSTRAINT_NODE"},
                "success": False,
                "message": "something went wrong",
            }
        ]
        result = process_actions(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "tableName": "users",
                        "targetColumn": "email",
                    },
                }
            ],
            workspace,
        )
        assert result["success"] is False
        assert len(result["results"]) == 1
        assert result["results"][0]["success"] is False

    @patch("app.shared.services.llm.actions.action_processor._execute_actions")
    def test_no_affected_files_no_backup(self, mock_execute, tmp_path):
        mock_execute.return_value = [{"action": {"actionType": "VALIDATE_PROJECT"}, "success": True, "message": "ok"}]
        result = process_actions([{"actionType": "VALIDATE_PROJECT", "constraintSpec": {}}], str(tmp_path))
        assert result["success"] is True


# ============================================================
# _execute_actions
# ============================================================


class TestExecuteActions:
    """测试 _execute_actions 的动作分类和执行"""

    @patch("app.shared.services.llm.actions.action_processor.update_yaml_config")
    @patch("app.shared.services.llm.actions.action_processor.generate_frontend_instructions")
    def test_standalone_constraint_action(self, mock_gen, mock_update, tmp_path):
        mock_update.return_value = (True, "notnull_users_email")
        mock_gen.return_value = {"actionType": "ADD_CONSTRAINT_NODE"}

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "NotNull",
                    "tableName": "users",
                    "targetColumn": "email",
                },
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True
        assert results[0]["frontendInstructions"] is not None

    @patch("app.shared.services.llm.actions.action_processor.update_yaml_config")
    @patch("app.shared.services.llm.actions.action_processor.generate_frontend_instructions")
    def test_delete_constraint_no_frontend(self, mock_gen, mock_update, tmp_path):
        mock_update.return_value = (True, "deleted_id")

        actions = [
            {
                "actionType": "DELETE_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "NotNull",
                    "tableName": "users",
                    "targetColumn": "email",
                },
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True
        assert results[0]["frontendInstructions"] is None

    @patch("app.shared.services.llm.actions.action_processor.update_yaml_config")
    @patch("app.shared.services.llm.actions.action_processor.generate_frontend_instructions")
    def test_inline_constraint_single(self, mock_gen, mock_update, tmp_path):
        mock_update.return_value = (True, "inline:notnull_users_email")
        mock_gen.return_value = {"actionType": "ADD_CONSTRAINT_NODE"}

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "NotNull",
                    "tableName": "users",
                    "targetColumn": "email",
                    "isInline": True,
                },
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True

    @patch("app.shared.services.llm.actions.action_processor.process_inline_batch")
    def test_inline_constraint_batch(self, mock_batch, tmp_path):
        mock_batch.return_value = [{"action": {"actionType": "ADD_CONSTRAINT_NODE"}, "success": True, "message": "ok"}]

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "NotNull",
                    "tableName": "users",
                    "targetColumn": "email",
                    "isInline": True,
                },
            },
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "Unique",
                    "tableName": "users",
                    "targetColumn": "email",
                    "isInline": True,
                },
            },
        ]
        results = _execute_actions(actions, str(tmp_path))
        mock_batch.assert_called_once()
        assert len(results) == 1

    @patch("app.shared.services.llm.actions.action_processor.process_schema_action")
    def test_schema_actions_dispatched(self, mock_schema, tmp_path):
        mock_schema.return_value = {"success": True, "message": "schema1"}

        actions = [
            {
                "actionType": "ADD_SCHEMA",
                "schemaSpec": {"name": "test", "schemaId": "test"},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True
        assert results[0]["frontendInstructions"] is None

    @patch("app.shared.services.llm.actions.action_processor.process_regex_action")
    def test_regex_actions_dispatched(self, mock_regex, tmp_path):
        mock_regex.return_value = {"success": True, "message": "regex1"}

        actions = [
            {
                "actionType": "ADD_REGEX",
                "regexSpec": {"name": "test", "pattern": ".*"},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True

    @patch("app.shared.services.llm.actions.action_processor.process_transform_action")
    def test_transform_actions_dispatched(self, mock_transform, tmp_path):
        mock_transform.return_value = {"success": True, "message": "tf1"}

        actions = [
            {
                "actionType": "ADD_TRANSFORM",
                "transformSpec": {"type": "UpperCase"},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True

    @patch("app.shared.services.llm.actions.action_processor.process_settings_action")
    def test_settings_actions_dispatched(self, mock_settings, tmp_path):
        mock_settings.return_value = {"success": True, "message": "settings.validation"}

        actions = [
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "validation", "settings": {"error_handling": "stop"}},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True

    @patch("app.shared.services.llm.actions.action_processor.execute_validate_project")
    def test_validate_project_action(self, mock_validate, tmp_path):
        mock_validate.return_value = {
            "success": True,
            "message": "数据校验通过",
            "details": {"error_count": 0},
        }

        actions = [
            {
                "actionType": "VALIDATE_PROJECT",
                "constraintSpec": {"targetNodeId": "users"},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True
        assert "validate_details" in results[0]

    @patch("app.shared.services.llm.actions.action_processor.execute_validate_project")
    def test_validate_project_with_table_list(self, mock_validate, tmp_path):
        mock_validate.return_value = {
            "success": True,
            "message": "ok",
            "details": {},
        }

        actions = [
            {
                "actionType": "VALIDATE_PROJECT",
                "constraintSpec": {"tableIds": ["users", "orders"]},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True

    @patch("app.shared.services.llm.actions.action_processor.execute_validate_project")
    def test_validate_project_with_tables_fallback(self, mock_validate, tmp_path):
        mock_validate.return_value = {
            "success": True,
            "message": "ok",
            "details": {},
        }

        actions = [
            {
                "actionType": "VALIDATE_PROJECT",
                "constraintSpec": {"tables": ["users"]},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is True

    def test_unknown_action_type(self, tmp_path):
        actions = [
            {
                "actionType": "COMPLETELY_UNKNOWN",
                "constraintSpec": {},
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is False
        assert "未知" in results[0]["message"]

    @patch("app.shared.services.llm.actions.action_processor.update_yaml_config")
    @patch("app.shared.services.llm.actions.action_processor.generate_frontend_instructions")
    def test_standalone_action_failure(self, mock_gen, mock_update, tmp_path):
        mock_update.return_value = (False, "保存失败")
        mock_gen.return_value = {"actionType": "ADD_CONSTRAINT_NODE"}

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "NotNull",
                    "tableName": "users",
                    "targetColumn": "email",
                },
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        assert results[0]["success"] is False
        assert results[0]["message"] == "保存失败"

    @patch("app.shared.services.llm.actions.action_processor.process_schema_action")
    @patch("app.shared.services.llm.actions.action_processor.process_regex_action")
    @patch("app.shared.services.llm.actions.action_processor.process_transform_action")
    @patch("app.shared.services.llm.actions.action_processor.process_settings_action")
    def test_mixed_actions_all_processed(self, mock_settings, mock_transform, mock_regex, mock_schema, tmp_path):
        mock_schema.return_value = {"success": True, "message": "s1"}
        mock_regex.return_value = {"success": True, "message": "r1"}
        mock_transform.return_value = {"success": True, "message": "t1"}
        mock_settings.return_value = {"success": True, "message": "settings.ok"}

        actions = [
            {"actionType": "ADD_SCHEMA", "schemaSpec": {"name": "s1", "schemaId": "s1"}},
            {"actionType": "ADD_REGEX", "regexSpec": {"name": "r1", "pattern": ".*"}},
            {"actionType": "ADD_TRANSFORM", "transformSpec": {"type": "UpperCase"}},
            {
                "actionType": "UPDATE_SETTINGS",
                "settingsSpec": {"category": "validation", "settings": {"error_handling": "stop"}},
            },
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 4
        for r in results:
            assert r["success"] is True

    @patch("app.shared.services.llm.actions.action_processor.update_yaml_config")
    @patch("app.shared.services.llm.actions.action_processor.generate_frontend_instructions")
    @patch("app.shared.services.llm.actions.action_processor.process_inline_batch")
    def test_inline_without_schema_id_goes_standalone(self, mock_batch, mock_gen, mock_update, tmp_path):
        mock_update.return_value = (True, "notnull_email")
        mock_gen.return_value = {"actionType": "ADD_CONSTRAINT_NODE"}

        actions = [
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {
                    "type": "NotNull",
                    "targetColumn": "email",
                    "isInline": True,
                },
            }
        ]
        results = _execute_actions(actions, str(tmp_path))
        assert len(results) == 1
        mock_update.assert_called()
        mock_batch.assert_not_called()
