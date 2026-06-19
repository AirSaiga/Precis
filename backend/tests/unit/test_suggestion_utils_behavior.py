"""
@fileoverview 建议工具行为测试
"""

from __future__ import annotations

from app.shared.services.llm.suggestion_utils import (
    normalize_constraint_type,
    suggest_constraints_for_type,
    suggest_similar_column,
    suggest_similar_constraint_type,
    suggest_similar_table,
)


class TestSuggestionUtils:
    """建议工具行为"""

    def test_normalize_constraint_type(self):
        assert normalize_constraint_type("not_null") == "NotNull"
        assert normalize_constraint_type("regex") == "Scripted"
        assert normalize_constraint_type("Unknown") == "Unknown"

    def test_suggest_similar_table(self):
        schema = {"tables": {"users": {}}, "table_name_to_id": {"user": "users"}}
        result = suggest_similar_table("user", schema)
        assert "users" in result

    def test_suggest_similar_column(self):
        table_info = {"columns": {"c1": {"name": "email"}, "c2": {"name": "phone"}}}
        result = suggest_similar_column("em", table_info)
        assert "email" in result

    def test_suggest_similar_constraint_type(self):
        result = suggest_similar_constraint_type("notnull")
        assert "NotNull" in result

    def test_suggest_constraints_for_type(self):
        assert "NotNull" in suggest_constraints_for_type("string")
        assert "Range" in suggest_constraints_for_type("integer")
        assert "DateLogic" in suggest_constraints_for_type("date")
