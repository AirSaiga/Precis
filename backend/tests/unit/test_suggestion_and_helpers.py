"""
@fileoverview LLM 建议工具和其他模块覆盖补充测试

测试范围:
- suggestion_utils: 约束类型标准化、表名/字段名/约束类型建议
- schema_helpers: schema 路径查找、冲突计算
- path_utils: 路径工具
"""


class TestNormalizeConstraintType:
    def test_not_null(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("not_null") == "NotNull"
        assert normalize_constraint_type("NOT_NULL") == "NotNull"
        assert normalize_constraint_type("NotNull") == "NotNull"

    def test_unique(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("unique") == "Unique"
        assert normalize_constraint_type("UNIQUE") == "Unique"

    def test_range(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("range") == "Range"
        assert normalize_constraint_type("RANGE") == "Range"

    def test_allowed_values(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("allowed_values") == "AllowedValues"
        assert normalize_constraint_type("ALLOWED_VALUES") == "AllowedValues"

    def test_foreign_key(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("foreign_key") == "ForeignKey"
        assert normalize_constraint_type("FOREIGN_KEY") == "ForeignKey"

    def test_conditional(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("conditional") == "Conditional"

    def test_scripted(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("scripted") == "Scripted"

    def test_date_logic(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("date_logic") == "DateLogic"
        assert normalize_constraint_type("DATE_LOGIC") == "DateLogic"

    def test_regex_maps_to_scripted(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("regex") == "Scripted"

    def test_unknown_passthrough(self):
        from app.shared.services.llm.suggestion_utils import normalize_constraint_type

        assert normalize_constraint_type("UnknownType") == "UnknownType"


class TestSuggestSimilarTable:
    def test_match_found(self):
        from app.shared.services.llm.suggestion_utils import suggest_similar_table

        schema = {"table_name_to_id": {"users": "users", "orders": "orders"}, "tables": {"users": {}, "orders": {}}}
        result = suggest_similar_table("user", schema)
        assert "users" in result

    def test_no_match(self):
        from app.shared.services.llm.suggestion_utils import suggest_similar_table

        schema = {"table_name_to_id": {"products": "products"}, "tables": {"products": {}}}
        result = suggest_similar_table("xyz", schema)
        assert "可用" in result or "检查" in result


class TestSuggestSimilarColumn:
    def test_match_found(self):
        from app.shared.services.llm.suggestion_utils import suggest_similar_column

        table_info = {"columns": {"email": {"name": "email"}, "age": {"name": "age"}}}
        result = suggest_similar_column("emial", table_info)
        assert "email" in result

    def test_no_match(self):
        from app.shared.services.llm.suggestion_utils import suggest_similar_column

        table_info = {"columns": {"col1": {"name": "col1"}, "col2": {"name": "col2"}}}
        result = suggest_similar_column("xyz", table_info)
        assert "可用" in result


class TestSuggestSimilarConstraintType:
    def test_close_match(self):
        from app.shared.services.llm.suggestion_utils import suggest_similar_constraint_type

        result = suggest_similar_constraint_type("NotNul")
        assert "NotNull" in result

    def test_no_match(self):
        from app.shared.services.llm.suggestion_utils import suggest_similar_constraint_type

        result = suggest_similar_constraint_type("CompletelyUnknown")
        assert "支持" in result


class TestSuggestConstraintsForType:
    def test_string(self):
        from app.shared.services.llm.suggestion_utils import suggest_constraints_for_type

        result = suggest_constraints_for_type("string")
        assert "NotNull" in result
        assert "Unique" in result

    def test_integer(self):
        from app.shared.services.llm.suggestion_utils import suggest_constraints_for_type

        result = suggest_constraints_for_type("integer")
        assert "Range" in result
        assert "ForeignKey" in result

    def test_decimal(self):
        from app.shared.services.llm.suggestion_utils import suggest_constraints_for_type

        result = suggest_constraints_for_type("decimal")
        assert "Range" in result

    def test_boolean(self):
        from app.shared.services.llm.suggestion_utils import suggest_constraints_for_type

        result = suggest_constraints_for_type("boolean")
        assert "AllowedValues" in result

    def test_date(self):
        from app.shared.services.llm.suggestion_utils import suggest_constraints_for_type

        result = suggest_constraints_for_type("date")
        assert "DateLogic" in result

    def test_unknown_type(self):
        from app.shared.services.llm.suggestion_utils import suggest_constraints_for_type

        result = suggest_constraints_for_type("unknown")
        assert "NotNull" in result


class TestSchemaHelpers:
    def test_get_schema_path_by_filename(self, tmp_path):
        from unittest.mock import MagicMock

        from app.api.routers.project.schema_helpers import _get_schema_path

        schemas_dir = tmp_path / "schemas"
        schemas_dir.mkdir()
        schema_file = schemas_dir / "orders.schema.yaml"
        schema_file.write_text("id: orders\nname: orders\n")

        manifest = MagicMock()
        manifest.schemas = []

        result = _get_schema_path(manifest, "orders", str(tmp_path))
        assert result == str(schema_file)

    def test_get_schema_path_not_found(self, tmp_path):
        from unittest.mock import MagicMock

        from app.api.routers.project.schema_helpers import _get_schema_path

        manifest = MagicMock()
        manifest.schemas = []

        result = _get_schema_path(manifest, "nonexistent", str(tmp_path))
        assert result is None

    def test_compute_conflicts_name_changed(self):
        from app.api.routers.project.schema_helpers import _compute_conflicts

        existing = {"name": "old_name"}
        new = {"name": "new_name"}
        conflicts = _compute_conflicts(existing, new)
        assert "name" in conflicts

    def test_compute_conflicts_no_change(self):
        from app.api.routers.project.schema_helpers import _compute_conflicts

        data = {"name": "users", "columns": [{"id": "c1", "name": "col1", "type": "string"}]}
        conflicts = _compute_conflicts(data, data)
        assert conflicts == []
