"""
@fileoverview 约束构建器和内联批量处理覆盖测试

覆盖目标:
- constraint_builder.py: _build_constraint_refs, _build_constraint_params
- inline_batch.py: _collect_target_schema_id, _is_inline_action
- constraint_id.py: 更多分支
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


class TestBuildConstraintRefs:
    def test_notnull_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        refs = _build_constraint_refs("NOT_NULL", "users", "email", {"targetNodeId": "sc_users", "targetColumnId": "c1"})
        assert refs["table_id"] == "sc_users"
        assert refs["column_id"] == "c1"

    def test_unique_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        refs = _build_constraint_refs("UNIQUE", "users", "email", {"targetNodeId": "sc_users", "targetColumnId": "c1"})
        assert refs["table_id"] == "sc_users"
        assert refs["column_ids"] == ["c1"]

    def test_foreign_key_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        spec = {
            "targetNodeId": "sc_orders",
            "targetColumnId": "user_id",
            "params": {"toTableId": "sc_users", "toColumnId": "id"},
        }
        refs = _build_constraint_refs("FOREIGN_KEY", "orders", "user_id", spec)
        assert refs["from_table_id"] == "sc_orders"
        assert refs["to_table_id"] == "sc_users"

    def test_conditional_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        spec = {
            "targetNodeId": "sc_users",
            "targetColumnId": "amount",
            "params": {
                "ifLogic": "and",
                "ifConditions": [{"ifColumnId": "status", "operator": "eq", "value": "active"}],
            },
        }
        refs = _build_constraint_refs("CONDITIONAL", "users", "amount", spec)
        assert refs["table_id"] == "sc_users"
        assert refs["if_logic"] == "and"
        assert len(refs["if_conditions"]) == 1

    def test_unknown_type_default_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        refs = _build_constraint_refs("UnknownType", "t", "c", {"targetNodeId": "t1", "targetColumnId": "c1"})
        assert refs["table_id"] == "t1"
        assert refs["column_id"] == "c1"

    def test_no_workspace_path(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        refs = _build_constraint_refs("NOT_NULL", "users", "email", {})
        assert "table_id" in refs


class TestBuildConstraintParams:
    def test_allowed_values(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("ALLOWED_VALUES", {"params": {"allowedValues": ["a", "b"]}})
        assert params["allowed_values"] == ["a", "b"]

    def test_range(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("RANGE", {"params": {"min": 0, "max": 100}})
        assert params["min"] == 0
        assert params["max"] == 100

    def test_scripted_with_pattern(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("REGEX", {"params": {"pattern": r"^\d+$"}})
        assert "expression" in params
        assert "re.match" in params["expression"]

    def test_scripted_with_expression(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("REGEX", {"params": {"expression": "value > 0"}})
        assert params["expression"] == "value > 0"

    def test_date_logic(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("DATE_LOGIC", {"params": {"logicMode": "compare", "compareOp": "gt"}})
        assert params["logic_mode"] == "compare"
        assert params["compare_op"] == "gt"

    def test_conditional(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("CONDITIONAL", {"params": {"thenValue": 42}})
        assert params["then_value"] == 42

    def test_unknown_type(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("UnknownType", {})
        assert params == {}

    def test_notnull_empty_params(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("NOT_NULL", {})
        assert params == {}


class TestInlineBatchHelpers:
    def test_collect_target_schema_id(self):
        from app.shared.services.llm.constraints.inline_batch import _collect_target_schema_id

        action = {"constraintSpec": {"tableName": "users"}}
        assert _collect_target_schema_id(action) == "users"

    def test_collect_target_schema_id_by_node_id(self):
        from app.shared.services.llm.constraints.inline_batch import _collect_target_schema_id

        action = {"constraintSpec": {"targetNodeId": "sc_users"}}
        assert _collect_target_schema_id(action) == "sc_users"

    def test_collect_target_schema_id_none(self):
        from app.shared.services.llm.constraints.inline_batch import _collect_target_schema_id

        assert _collect_target_schema_id({}) is None

    def test_is_inline_action_true(self):
        from app.shared.services.llm.constraints.inline_batch import _is_inline_action

        action = {"constraintSpec": {"isInline": True}}
        assert _is_inline_action(action) is True

    def test_is_inline_action_false(self):
        from app.shared.services.llm.constraints.inline_batch import _is_inline_action

        action = {"constraintSpec": {}}
        assert _is_inline_action(action) is False

    def test_is_inline_action_no_spec(self):
        from app.shared.services.llm.constraints.inline_batch import _is_inline_action

        assert _is_inline_action({}) is False

    def test_process_inline_batch_empty(self):
        from app.shared.services.llm.constraints.inline_batch import process_inline_batch

        assert process_inline_batch([], "/workspace") == []


class TestConstraintTypeMap:
    def test_all_mappings(self):
        from app.shared.services.llm.constraints.constraint_builder import CONSTRAINT_TYPE_MAP

        assert CONSTRAINT_TYPE_MAP["NOT_NULL"] == "NotNull"
        assert CONSTRAINT_TYPE_MAP["UNIQUE"] == "Unique"
        assert CONSTRAINT_TYPE_MAP["ALLOWED_VALUES"] == "AllowedValues"
        assert CONSTRAINT_TYPE_MAP["RANGE"] == "Range"
        assert CONSTRAINT_TYPE_MAP["REGEX"] == "Scripted"
        assert CONSTRAINT_TYPE_MAP["FOREIGN_KEY"] == "ForeignKey"
        assert CONSTRAINT_TYPE_MAP["CONDITIONAL"] == "Conditional"
        assert CONSTRAINT_TYPE_MAP["DATE_LOGIC"] == "DateLogic"
