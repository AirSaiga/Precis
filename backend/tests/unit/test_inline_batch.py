"""@fileoverview inline_batch 单元测试

覆盖 process_inline_batch、_collect_target_schema_id、_is_inline_action。
"""

from __future__ import annotations

import yaml

from app.shared.services.llm.constraints.inline_batch import (
    _collect_target_schema_id,
    _is_inline_action,
    process_inline_batch,
)


def _make_action(
    action_type="ADD_CONSTRAINT_NODE",
    target_node_id="users",
    table_name="",
    constraint_type="NOT_NULL",
    target_column="email",
    target_column_id="col_email",
    is_inline=True,
    **extra_spec,
):
    spec = {
        "targetNodeId": target_node_id,
        "tableName": table_name,
        "type": constraint_type,
        "targetColumn": target_column,
        "targetColumnId": target_column_id,
        "isInline": is_inline,
    }
    spec.update(extra_spec)
    return {"actionType": action_type, "constraintSpec": spec}


def _write_schema(tmp_path, schema: dict):
    schemas_dir = tmp_path / "schemas"
    schemas_dir.mkdir(exist_ok=True)
    filepath = schemas_dir / f"{schema['id']}.schema.yaml"
    with open(filepath, "w", encoding="utf-8") as f:
        yaml.safe_dump(schema, f)


def _make_schema(
    id="users",
    name="用户表",
    columns=None,
    constraints=None,
):
    s = {"id": id, "name": name}
    s["columns"] = columns or [
        {"id": "col_email", "name": "email", "type": "string"},
        {"id": "col_name", "name": "name", "type": "string"},
    ]
    if constraints is not None:
        s["constraints"] = constraints
    return s


class TestCollectTargetSchemaId:
    def test_prefers_table_name(self):
        action = _make_action(target_node_id="id1", table_name="users")
        assert _collect_target_schema_id(action) == "users"

    def test_falls_back_to_target_node_id(self):
        action = _make_action(target_node_id="id1", table_name="")
        assert _collect_target_schema_id(action) == "id1"

    def test_returns_none_when_empty(self):
        action = {"constraintSpec": {}}
        assert _collect_target_schema_id(action) is None


class TestIsInlineAction:
    def test_inline_true(self):
        assert _is_inline_action(_make_action(is_inline=True)) is True

    def test_inline_false(self):
        assert _is_inline_action(_make_action(is_inline=False)) is False

    def test_missing_spec(self):
        assert _is_inline_action({}) is False


class TestProcessInlineBatch:
    def test_empty_actions_returns_empty(self, tmp_path):
        result = process_inline_batch([], str(tmp_path))
        assert result == []

    def test_schema_not_found_returns_all_failed(self, tmp_path):
        actions = [_make_action()]
        result = process_inline_batch(actions, str(tmp_path))
        assert len(result) == 1
        assert result[0]["success"] is False
        assert "未找到" in result[0]["message"]

    def test_add_inline_constraint(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        actions = [_make_action()]
        result = process_inline_batch(actions, str(tmp_path))
        assert len(result) == 1
        assert result[0]["success"] is True

        schema_file = tmp_path / "schemas" / "users.schema.yaml"
        with open(schema_file, encoding="utf-8") as f:
            saved = yaml.safe_load(f)
        assert len(saved["constraints"]) == 1
        assert saved["constraints"][0]["type"] == "NotNull"

    def test_update_existing_constraint(self, tmp_path):
        _write_schema(
            tmp_path,
            _make_schema(constraints=[{"id": "old", "column": "col_email", "type": "NotNull"}]),
        )
        actions = [_make_action()]
        result = process_inline_batch(actions, str(tmp_path))
        assert result[0]["success"] is True

    def test_column_not_found_returns_failure(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        actions = [_make_action(target_column="nonexistent", target_column_id="")]
        result = process_inline_batch(actions, str(tmp_path))
        assert result[0]["success"] is False
        assert "未找到列" in result[0]["message"]

    def test_resolves_column_by_name(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        actions = [_make_action(target_column="email", target_column_id="")]
        result = process_inline_batch(actions, str(tmp_path))
        assert result[0]["success"] is True

    def test_multiple_actions_batch(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        actions = [
            _make_action(constraint_type="NOT_NULL", target_column="email", target_column_id="col_email"),
            _make_action(constraint_type="NOT_NULL", target_column="name", target_column_id="col_name"),
        ]
        result = process_inline_batch(actions, str(tmp_path))
        assert len(result) == 2
        assert all(r["success"] for r in result)

    def test_mixed_success_and_failure(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        actions = [
            _make_action(target_column="email", target_column_id="col_email"),
            _make_action(target_column="nonexistent", target_column_id=""),
        ]
        result = process_inline_batch(actions, str(tmp_path))
        assert result[0]["success"] is True
        assert result[1]["success"] is False

    def test_schema_matched_by_name(self, tmp_path):
        _write_schema(tmp_path, _make_schema(id="sc_abc", name="用户表"))
        actions = [_make_action(target_node_id="", table_name="用户表")]
        result = process_inline_batch(actions, str(tmp_path))
        assert result[0]["success"] is True

    def test_allowed_values_with_params(self, tmp_path):
        _write_schema(tmp_path, _make_schema())
        actions = [
            _make_action(
                constraint_type="ALLOWED_VALUES",
                target_column="email",
                target_column_id="col_email",
                allowedValues=["a@b.com", "c@d.com"],
            )
        ]
        result = process_inline_batch(actions, str(tmp_path))
        assert result[0]["success"] is True

        schema_file = tmp_path / "schemas" / "users.schema.yaml"
        with open(schema_file, encoding="utf-8") as f:
            saved = yaml.safe_load(f)
        assert "params" in saved["constraints"][0]
