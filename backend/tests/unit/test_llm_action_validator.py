"""
@fileoverview LLM action_validator 单元测试 (T18 Part 2)

覆盖 ActionValidator.validate 及其所有子验证方法，
ValidationError、ValidationResult 数据结构，和 format_validation_result。
"""

from __future__ import annotations

from app.shared.services.llm.actions.action_validator import (
    ActionValidator,
    ValidationError,
    ValidationResult,
    format_validation_result,
)


def _create_schema_dir(tmp_path, schemas: list[dict]):
    """Helper: 在 tmp_path 下创建 schemas 目录和文件"""
    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir()
    import yaml

    for s in schemas:
        filepath = schemas_dir / f"{s['id']}.schema.yaml"
        with open(filepath, "w", encoding="utf-8") as f:
            yaml.safe_dump(s, f)


# ============================================================
# ValidationError
# ============================================================


class TestValidationError:
    def test_create_basic_error(self):
        err = ValidationError(
            action_index=0,
            action_type="ADD_CONSTRAINT_NODE",
            error_type="table_not_found",
            message="表 'users' 不存在",
        )
        assert err.action_index == 0
        assert err.error_type == "table_not_found"
        assert err.suggestion is None
        assert err.auto_fixable is False

    def test_create_error_with_suggestion(self):
        err = ValidationError(
            action_index=1,
            action_type="ADD_CONSTRAINT_NODE",
            error_type="column_not_found",
            message="字段 'emial' 不存在",
            suggestion="是否指: email?",
            auto_fixable=False,
        )
        assert err.suggestion == "是否指: email?"
        assert err.auto_fixable is False


# ============================================================
# ValidationResult
# ============================================================


class TestValidationResult:
    def test_empty_result(self):
        result = ValidationResult()
        assert result.has_errors is False
        assert result.has_warnings is False
        assert result.all_valid is True
        assert result.partial_valid is False

    def test_result_with_errors(self):
        result = ValidationResult()
        result.errors.append(
            ValidationError(0, "ADD", "error", "msg")
        )
        assert result.has_errors is True
        assert result.all_valid is False
        assert result.partial_valid is False

    def test_result_with_warnings(self):
        result = ValidationResult()
        result.warnings.append(
            ValidationError(0, "UNKNOWN", "warning", "msg")
        )
        assert result.has_warnings is True
        assert result.has_errors is False
        assert result.all_valid is True  # warnings don't block

    def test_partial_valid(self):
        result = ValidationResult()
        result.errors.append(
            ValidationError(0, "ADD", "error", "msg")
        )
        result.valid_actions.append({"actionType": "VALIDATE"})
        assert result.partial_valid is True

    def test_invalid_action_indices(self):
        result = ValidationResult()
        result.invalid_action_indices.add(2)
        result.invalid_action_indices.add(5)
        assert result.all_valid is False


# ============================================================
# format_validation_result
# ============================================================


class TestFormatValidationResult:
    def test_all_valid(self):
        result = ValidationResult()
        formatted = format_validation_result(result)
        assert "[OK]" in formatted

    def test_with_errors(self):
        result = ValidationResult()
        result.errors.append(
            ValidationError(
                action_index=0,
                action_type="ADD_CONSTRAINT_NODE",
                error_type="table_not_found",
                message="表 'users' 不存在",
                suggestion="是否指: user?",
            )
        )
        formatted = format_validation_result(result)
        assert "[!]" in formatted
        assert "表 'users' 不存在" in formatted
        assert "是否指: user?" in formatted

    def test_with_warnings(self):
        result = ValidationResult()
        result.warnings.append(
            ValidationError(
                action_index=0,
                action_type="UNKNOWN_ACTION",
                error_type="unknown_action_type",
                message="未知的动作类型",
            )
        )
        formatted = format_validation_result(result)
        assert "未知" in formatted

    def test_partial_valid_info(self):
        result = ValidationResult()
        result.errors.append(
            ValidationError(0, "ADD", "error", "msg")
        )
        result.valid_actions.append({"test": "ok"})
        result.invalid_action_indices.add(0)
        formatted = format_validation_result(result)
        assert "1 个操作有效" in formatted


# ============================================================
# ActionValidator — _load_project_schema
# ============================================================


class TestLoadProjectSchema:
    def test_no_schemas_dir(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        schema = validator._load_project_schema()
        assert schema == {"tables": {}, "table_name_to_id": {}}

    def test_loads_schema_files(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [
                        {"id": "sc_email", "name": "email", "type": "string"},
                        {"id": "sc_name", "name": "name", "type": "string"},
                    ],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        schema = validator._load_project_schema()
        assert "sc_users" in schema["tables"]
        assert schema["tables"]["sc_users"]["name"] == "users"
        assert "sc_email" in schema["tables"]["sc_users"]["columns"]
        assert (
            schema["tables"]["sc_users"]["columns"]["sc_email"]["type"] == "string"
        )

    def test_caches_schema(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_cache",
                    "name": "cache_test",
                    "columns": [],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        schema1 = validator._load_project_schema()
        schema2 = validator._load_project_schema()
        assert schema1 is schema2

    def test_table_name_to_id_mapping(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        schema = validator._load_project_schema()
        assert "users" in schema["table_name_to_id"]
        assert "sc_users" in schema["table_name_to_id"]["users"]

    def test_multiple_tables_same_name(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users_v1",
                    "name": "users",
                    "columns": [],
                },
                {
                    "version": 2,
                    "id": "sc_users_v2",
                    "name": "users",
                    "columns": [],
                },
            ],
        )
        validator = ActionValidator(str(tmp_path))
        schema = validator._load_project_schema()
        assert len(schema["table_name_to_id"]["users"]) == 2

    def test_missing_name_uses_id(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_nameless",
                    "columns": [{"id": "sc_c1", "name": "c1", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        schema = validator._load_project_schema()
        assert "sc_nameless" in schema["tables"]
        assert schema["tables"]["sc_nameless"]["name"] == ""


# ============================================================
# ActionValidator — validate (主入口)
# ============================================================


class TestValidate:
    def test_empty_actions(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate([])
        assert result.all_valid is True
        assert len(result.errors) == 0

    def test_unknown_action_type_is_warning(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate([{"actionType": "MAGICAL_ACTION"}])
        assert len(result.warnings) == 1
        assert result.warnings[0].error_type == "unknown_action_type"
        assert len(result.valid_actions) == 1

    def test_constraint_action_valid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "targetNodeId": "sc_users",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert result.all_valid is True
        assert len(result.valid_actions) == 1

    def test_constraint_action_table_not_found(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "tableName": "nonexistent",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert len(result.errors) == 1
        assert result.errors[0].error_type == "table_not_found"
        assert 0 in result.invalid_action_indices

    def test_constraint_action_missing_table_info(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert len(result.errors) == 1
        assert result.errors[0].error_type == "missing_table"

    def test_constraint_action_missing_column(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "tableName": "users",
                        "targetColumn": "",
                    },
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "missing_column" for e in result.errors)

    def test_constraint_action_column_not_found(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "targetNodeId": "sc_users",
                        "targetColumn": "phone",
                    },
                }
            ]
        )
        assert len(result.errors) == 1
        assert result.errors[0].error_type == "column_not_found"

    def test_constraint_action_invalid_type(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "MagicConstraint",
                        "targetNodeId": "sc_users",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "invalid_constraint_type" for e in result.errors)

    def test_constraint_action_missing_type(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "targetNodeId": "sc_users",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "missing_constraint_type" for e in result.errors)

    def test_delete_action_skips_type_and_params_check(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "DELETE_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "",
                        "targetNodeId": "sc_users",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert result.all_valid is True


# ============================================================
# ActionValidator — _validate_validate_action
# ============================================================


class TestValidateValidateAction:
    def test_no_table_filter_is_valid(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        # 直接调用 validate 方法
        result = validator.validate(
            [
                {
                    "actionType": "VALIDATE_PROJECT",
                    "constraintSpec": {},
                }
            ]
        )
        assert result.all_valid is True

    def test_table_by_id_exists(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "VALIDATE_PROJECT",
                    "constraintSpec": {"targetNodeId": "sc_users"},
                }
            ]
        )
        assert result.all_valid is True

    def test_table_by_name_exists(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "VALIDATE_PROJECT",
                    "constraintSpec": {"tableName": "users"},
                }
            ]
        )
        assert result.all_valid is True

    def test_table_not_found(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "VALIDATE_PROJECT",
                    "constraintSpec": {"tableName": "nonexistent"},
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "table_not_found" for e in result.errors)

    def test_table_list_found(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "VALIDATE_PROJECT",
                    "constraintSpec": {"tables": ["sc_users"]},
                }
            ]
        )
        assert result.all_valid is True


# ============================================================
# ActionValidator — _validate_constraint_params
# ============================================================


class TestValidateConstraintParams:
    def test_range_missing_min_and_max(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_products",
                    "name": "products",
                    "columns": [
                        {"id": "sc_price", "name": "price", "type": "decimal"}
                    ],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_products",
                        "targetColumn": "price",
                        "params": {},
                    },
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "missing_required_param" for e in result.errors)

    def test_range_with_min_is_valid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_products",
                    "name": "products",
                    "columns": [
                        {"id": "sc_price", "name": "price", "type": "decimal"}
                    ],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_products",
                        "targetColumn": "price",
                        "params": {"min": 0},
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_range_with_max_is_valid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_products",
                    "name": "products",
                    "columns": [
                        {"id": "sc_price", "name": "price", "type": "decimal"}
                    ],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_products",
                        "targetColumn": "price",
                        "params": {"max": 1000},
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_range_with_min_none_is_invalid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_products",
                    "name": "products",
                    "columns": [
                        {"id": "sc_price", "name": "price", "type": "decimal"}
                    ],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_products",
                        "targetColumn": "price",
                        "params": {"min": None, "max": None},
                    },
                }
            ]
        )
        assert len(result.errors) >= 1

    def test_allowed_values_missing(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_role", "name": "role", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "AllowedValues",
                        "targetNodeId": "sc_users",
                        "targetColumn": "role",
                        "params": {},
                    },
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "missing_required_param" for e in result.errors)

    def test_allowed_values_present_is_valid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_role", "name": "role", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "AllowedValues",
                        "targetNodeId": "sc_users",
                        "targetColumn": "role",
                        "params": {"allowedValues": ["admin", "user"]},
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_foreign_key_missing_params(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_orders",
                    "name": "orders",
                    "columns": [{"id": "sc_user_id", "name": "user_id", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "ForeignKey",
                        "targetNodeId": "sc_orders",
                        "targetColumn": "user_id",
                        "params": {},
                    },
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "missing_required_param" for e in result.errors)

    def test_foreign_key_valid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_orders",
                    "name": "orders",
                    "columns": [{"id": "sc_user_id", "name": "user_id", "type": "string"}],
                },
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_id", "name": "id", "type": "string"}],
                },
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "ForeignKey",
                        "targetNodeId": "sc_orders",
                        "targetColumn": "user_id",
                        "params": {"toTableId": "sc_users", "toColumnId": "sc_id"},
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_foreign_key_target_table_not_found(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_orders",
                    "name": "orders",
                    "columns": [{"id": "sc_user_id", "name": "user_id", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "ForeignKey",
                        "targetNodeId": "sc_orders",
                        "targetColumn": "user_id",
                        "params": {"toTableId": "sc_nonexistent", "toColumnId": "sc_id"},
                    },
                }
            ]
        )
        assert any(e.error_type == "foreign_key_table_not_found" for e in result.errors)

    def test_foreign_key_target_column_not_found(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_orders",
                    "name": "orders",
                    "columns": [{"id": "sc_user_id", "name": "user_id", "type": "string"}],
                },
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_id", "name": "id", "type": "string"}],
                },
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "ForeignKey",
                        "targetNodeId": "sc_orders",
                        "targetColumn": "user_id",
                        "params": {
                            "toTableId": "sc_users",
                            "toColumnId": "sc_nonexistent_col",
                        },
                    },
                }
            ]
        )
        assert any(
            e.error_type == "foreign_key_column_not_found" for e in result.errors
        )


# ============================================================
# ActionValidator — _validate_type_compatibility
# ============================================================


class TestValidateTypeCompatibility:
    def test_range_on_string_is_incompatible(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_name", "name": "name", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_users",
                        "targetColumn": "name",
                        "params": {"min": 0},
                    },
                }
            ]
        )
        assert any(e.error_type == "type_incompatibility" for e in result.errors)

    def test_range_on_integer_is_compatible(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_products",
                    "name": "products",
                    "columns": [{"id": "sc_age", "name": "age", "type": "integer"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_products",
                        "targetColumn": "age",
                        "params": {"min": 0},
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_range_on_decimal_is_compatible(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_items",
                    "name": "items",
                    "columns": [{"id": "sc_price", "name": "price", "type": "decimal"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_items",
                        "targetColumn": "price",
                        "params": {"min": 0},
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_notnull_on_any_type_is_compatible(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_flag", "name": "flag", "type": "boolean"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "targetNodeId": "sc_users",
                        "targetColumn": "flag",
                    },
                }
            ]
        )
        assert result.all_valid is True


# ============================================================
# ActionValidator — _validate_schema_action
# ============================================================


class TestValidateSchemaAction:
    def test_add_schema_missing_name(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_SCHEMA",
                    "schemaSpec": {"name": "", "columns": []},
                }
            ]
        )
        assert len(result.errors) >= 1
        assert any(e.error_type == "missing_schema_name" for e in result.errors)

    def test_add_schema_invalid_column_type(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_SCHEMA",
                    "schemaSpec": {
                        "name": "test",
                        "schemaId": "test",
                        "columns": [{"name": "c1", "type": "binary"}],
                    },
                }
            ]
        )
        assert any(e.error_type == "invalid_column_type" for e in result.errors)

    def test_add_schema_valid(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_SCHEMA",
                    "schemaSpec": {
                        "name": "test",
                        "schemaId": "test",
                        "columns": [{"name": "c1", "type": "string"}],
                    },
                }
            ]
        )
        assert result.all_valid is True

    def test_update_schema_missing_id(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_SCHEMA",
                    "schemaSpec": {},
                }
            ]
        )
        assert any(e.error_type == "missing_schema_id" for e in result.errors)

    def test_delete_schema_missing_id(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "DELETE_SCHEMA",
                    "schemaSpec": {},
                }
            ]
        )
        assert any(e.error_type == "missing_schema_id" for e in result.errors)


# ============================================================
# ActionValidator — _validate_regex_action
# ============================================================


class TestValidateRegexAction:
    def test_add_regex_missing_name(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_REGEX",
                    "regexSpec": {"name": "", "pattern": ".*"},
                }
            ]
        )
        assert any(e.error_type == "missing_regex_name" for e in result.errors)

    def test_add_regex_missing_pattern(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_REGEX",
                    "regexSpec": {"name": "test", "pattern": ""},
                }
            ]
        )
        assert any(e.error_type == "missing_regex_pattern" for e in result.errors)

    def test_add_regex_valid(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_REGEX",
                    "regexSpec": {"name": "test", "pattern": ".*"},
                }
            ]
        )
        assert result.all_valid is True

    def test_invalid_match_mode(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_REGEX",
                    "regexSpec": {
                        "name": "test",
                        "pattern": ".*",
                        "matchMode": "invalid",
                    },
                }
            ]
        )
        assert any(e.error_type == "invalid_match_mode" for e in result.errors)

    def test_update_regex_missing_id(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_REGEX",
                    "regexSpec": {},
                }
            ]
        )
        assert any(e.error_type == "missing_regex_id" for e in result.errors)

    def test_delete_regex_missing_id(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "DELETE_REGEX",
                    "regexSpec": {},
                }
            ]
        )
        assert any(e.error_type == "missing_regex_id" for e in result.errors)


# ============================================================
# ActionValidator — _validate_transform_action
# ============================================================


class TestValidateTransformAction:
    def test_add_transform_missing_type(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_TRANSFORM",
                    "transformSpec": {"type": ""},
                }
            ]
        )
        assert any(e.error_type == "missing_transform_type" for e in result.errors)

    def test_add_transform_invalid_type(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_TRANSFORM",
                    "transformSpec": {"type": "InvalidTransform"},
                }
            ]
        )
        assert any(e.error_type == "invalid_transform_type" for e in result.errors)

    def test_add_transform_valid(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_TRANSFORM",
                    "transformSpec": {"type": "UpperCase"},
                }
            ]
        )
        assert result.all_valid is True

    def test_update_transform_missing_id(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_TRANSFORM",
                    "transformSpec": {},
                }
            ]
        )
        assert any(e.error_type == "missing_transform_id" for e in result.errors)

    def test_delete_transform_missing_id(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "DELETE_TRANSFORM",
                    "transformSpec": {},
                }
            ]
        )
        assert any(e.error_type == "missing_transform_id" for e in result.errors)


# ============================================================
# ActionValidator — _validate_settings_action
# ============================================================


class TestValidateSettingsAction:
    def test_missing_category(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_SETTINGS",
                    "settingsSpec": {"category": "", "settings": {"k": "v"}},
                }
            ]
        )
        assert any(e.error_type == "missing_settings_category" for e in result.errors)

    def test_invalid_category(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_SETTINGS",
                    "settingsSpec": {"category": "bad", "settings": {"k": "v"}},
                }
            ]
        )
        assert any(e.error_type == "invalid_settings_category" for e in result.errors)

    def test_empty_settings(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_SETTINGS",
                    "settingsSpec": {"category": "validation", "settings": {}},
                }
            ]
        )
        assert any(e.error_type == "empty_settings" for e in result.errors)

    def test_valid_settings(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "UPDATE_SETTINGS",
                    "settingsSpec": {
                        "category": "validation",
                        "settings": {"error_handling": "stop"},
                    },
                }
            ]
        )
        assert result.all_valid is True


# ============================================================
# ActionValidator — 完整流程 / 多个动作混合
# ============================================================


class TestMultiActionScenarios:
    def test_mixed_valid_and_invalid(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "targetNodeId": "sc_users",
                        "targetColumn": "email",
                    },
                },
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "Range",
                        "targetNodeId": "sc_users",
                        "targetColumn": "email",
                        "params": {},
                    },
                },
            ]
        )
        assert len(result.valid_actions) == 1
        assert len(result.invalid_action_indices) == 1

    def test_alias_constraint_types(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users",
                    "name": "users",
                    "columns": [{"id": "sc_email", "name": "email", "type": "string"}],
                }
            ],
        )
        validator = ActionValidator(str(tmp_path))
        for alias in ["NOT_NULL", "not_null", "NotNull"]:
            result = validator.validate(
                [
                    {
                        "actionType": "ADD_CONSTRAINT_NODE",
                        "constraintSpec": {
                            "type": alias,
                            "targetNodeId": "sc_users",
                            "targetColumn": "email",
                        },
                    }
                ]
            )
            assert result.all_valid is True, f"Alias {alias} should be valid"

    def test_ambiguous_table_name_is_error(self, tmp_path):
        _create_schema_dir(
            tmp_path,
            [
                {
                    "version": 2,
                    "id": "sc_users_v1",
                    "name": "users",
                    "columns": [],
                },
                {
                    "version": 2,
                    "id": "sc_users_v2",
                    "name": "users",
                    "columns": [],
                },
            ],
        )
        validator = ActionValidator(str(tmp_path))
        result = validator.validate(
            [
                {
                    "actionType": "ADD_CONSTRAINT_NODE",
                    "constraintSpec": {
                        "type": "NotNull",
                        "tableName": "users",
                        "targetColumn": "email",
                    },
                }
            ]
        )
        assert any(e.error_type == "ambiguous_table_name" for e in result.errors)

    def test_ensure_result_object_reusable(self, tmp_path):
        validator = ActionValidator(str(tmp_path))
        result1 = validator.validate([{"actionType": "UNKNOWN_ACTION"}])
        result2 = validator.validate([])
        assert result1.has_warnings is True
        assert result2.has_warnings is False
        assert result2.all_valid is True
