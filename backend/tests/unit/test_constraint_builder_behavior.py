"""
@fileoverview 约束结构构建行为测试

覆盖 _build_constraint_refs 与 _build_constraint_params。
"""

from __future__ import annotations

from app.shared.services.llm.constraints.constraint_builder import (
    _build_constraint_params,
    _build_constraint_refs,
)


class TestBuildConstraintRefs:
    """_build_constraint_refs 行为"""

    def test_not_null_refs(self):
        spec = {"targetNodeId": "users", "targetColumnId": "email"}
        refs = _build_constraint_refs("NotNull", "users", "email", spec)
        assert refs == {"table_id": "users", "column_id": "email"}

    def test_unique_refs_uses_column_ids(self):
        spec = {"targetNodeId": "users", "targetColumnId": "email"}
        refs = _build_constraint_refs("Unique", "users", "email", spec)
        assert refs == {"table_id": "users", "column_ids": ["email"]}

    def test_foreign_key_refs(self):
        spec = {
            "targetNodeId": "orders",
            "targetColumnId": "user_id",
            "params": {"toTableId": "users", "toColumnId": "id"},
        }
        refs = _build_constraint_refs("ForeignKey", "orders", "user_id", spec)
        assert refs["from_table_id"] == "orders"
        assert refs["to_table_id"] == "users"


class TestBuildConstraintParams:
    """_build_constraint_params 行为"""

    def test_allowed_values(self):
        params = _build_constraint_params("AllowedValues", {"params": {"allowedValues": ["a", "b"]}})
        assert params == {"allowed_values": ["a", "b"]}

    def test_range(self):
        params = _build_constraint_params("Range", {"params": {"min": 0, "max": 100}})
        assert params == {"min": 0, "max": 100}

    def test_scripted_with_pattern(self):
        params = _build_constraint_params("Scripted", {"params": {"pattern": r"^\d+$"}})
        assert params["expression"].startswith("re.match")

    def test_date_logic(self):
        params = _build_constraint_params("DateLogic", {"params": {"logicMode": "compare"}})
        assert params["logic_mode"] == "compare"
