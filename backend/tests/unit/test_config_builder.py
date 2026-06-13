"""@fileoverview config_builder 单元测试

覆盖 build_config 及其内部的约束/正则节点标准化逻辑。
"""

from __future__ import annotations

from types import SimpleNamespace

import yaml

from app.shared.services.llm.generation.config_builder import build_config


def _make_options(**overrides):
    defaults = {
        "keep_existing": False,
        "generate_schemas": True,
        "generate_constraints": True,
        "generate_regex_nodes": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _make_profiling(path="data/users.csv", table_name="users", sheet_name=None):
    item = {"path": path, "table_name": table_name}
    if sheet_name:
        item["sheet_name"] = sheet_name
    return item


class TestBuildConfigBasic:
    def test_returns_success_with_empty_inputs(self):
        result = build_config(
            project_id="test",
            project_name="Test",
            config_path=None,
            profiling_data=[],
            llm_result={},
            options=_make_options(),
            existing_config=None,
        )
        assert result["success"] is True
        assert result["warnings"] == []
        assert result["manifest"]["version"] == 2
        assert result["manifest"]["project"]["id"] == "test"

    def test_manifest_lists_schemas_and_constraints(self):
        llm_result = {
            "schemas": [{"id": "users", "name": "users", "columns": []}],
            "constraints": [{"type": "NotNull", "table_id": "users", "column_id": "email"}],
        }
        result = build_config(
            project_id="p1",
            project_name="P1",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["manifest"]["schemas"]) == 1
        assert len(result["manifest"]["constraints"]) == 1

    def test_yaml_preview_is_valid_yaml(self):
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result={},
            options=_make_options(),
            existing_config=None,
        )
        parsed = yaml.safe_load(result["yaml_preview"])
        assert "manifest" in parsed


class TestKeepExisting:
    def test_keeps_existing_schemas_and_constraints(self):
        existing = {
            "schemas": {"old_schema": {"id": "old_schema"}},
            "constraints": {"old_c": {"id": "old_c"}},
            "regex_nodes": {"old_r": {"id": "old_r"}},
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result={},
            options=_make_options(keep_existing=True),
            existing_config=existing,
        )
        assert "old_schema" in result["schemas"]
        assert "old_c" in result["constraints"]
        assert "old_r" in result["regex_nodes"]

    def test_reuses_existing_schema_id_for_same_source(self):
        """同一 source.path 的 schema 应复用已有 ID，而非生成新 ID"""
        existing_schema_id = "sc_existing_employees"
        existing = {
            "schemas": {
                existing_schema_id: {
                    "id": existing_schema_id,
                    "name": "Employees",
                    "source": {
                        "mode": "relative_file",
                        "path": "employees.xlsx",
                        "header_row": 0,
                    },
                    "columns": [{"id": "old_col", "name": "old_col", "type": "string"}],
                }
            }
        }
        profiling = [_make_profiling("data/employees.xlsx", "employees")]
        llm_result = {
            "schemas": [
                {
                    "name": "employees",
                    "columns": [{"id": "emp_id", "name": "emp_id", "type": "integer", "primary_key": True}],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=profiling,
            llm_result=llm_result,
            options=_make_options(keep_existing=True),
            existing_config=existing,
        )
        # 应只有一个 schema，且 ID 复用已有 ID
        assert len(result["schemas"]) == 1
        assert existing_schema_id in result["schemas"]
        # 内容应被 AI 生成的新内容覆盖
        schema = result["schemas"][existing_schema_id]
        assert schema["name"] == "employees"
        assert len(schema["columns"]) == 1
        assert schema["columns"][0]["id"] == "emp_id"


class TestSchemaGeneration:
    def test_generates_schema_with_source_from_profiling(self):
        profiling = [_make_profiling("data/users.csv", "users")]
        llm_result = {"schemas": [{"id": "users", "name": "users", "columns": []}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path="/project",
            profiling_data=profiling,
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        # 语义化 ID：直接使用 LLM 提供的 id
        assert "users" in result["schemas"]
        schema = list(result["schemas"].values())[0]
        assert schema["version"] == 2
        assert schema["source"]["mode"] == "relative_file"

    def test_schema_csv_source_options(self):
        profiling = [_make_profiling("data/users.csv", "users")]
        llm_result = {
            "schemas": [
                {
                    "id": "users",
                    "name": "users",
                    "_source_path": "data/users.csv",
                    "columns": [],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=profiling,
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        schema = list(result["schemas"].values())[0]
        source = schema["source"]
        assert "delimiter" in source.get("options", {})

    def test_schema_xlsx_source_options(self):
        profiling = [_make_profiling("data/users.xlsx", "users")]
        llm_result = {
            "schemas": [
                {
                    "id": "users",
                    "name": "users",
                    "_source_path": "data/users.xlsx",
                    "columns": [],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=profiling,
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        schema = list(result["schemas"].values())[0]
        source = schema["source"]
        assert source["options"]["engine"] == "openpyxl"

    def test_schema_json_source_options(self):
        profiling = [_make_profiling("data/data.json", "records")]
        llm_result = {
            "schemas": [
                {
                    "id": "records",
                    "name": "records",
                    "_source_path": "data/data.json",
                    "columns": [],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=profiling,
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        schema = list(result["schemas"].values())[0]
        source = schema["source"]
        assert source["options"]["format"] == "auto"

    def test_schema_with_sheet_name(self):
        profiling = [_make_profiling("data/users.xlsx", "users", sheet_name="Sheet1")]
        llm_result = {
            "schemas": [
                {
                    "id": "users",
                    "name": "users",
                    "_source_path": "data/users.xlsx",
                    "columns": [],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=profiling,
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        schema = list(result["schemas"].values())[0]
        assert schema["source"]["sheet"] == "Sheet1"

    def test_schema_inline_constraints(self):
        llm_result = {
            "schemas": [
                {
                    "id": "users",
                    "name": "users",
                    "columns": [],
                    "constraints": [{"type": "inline", "column": "id"}],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        # 无 profiling 数据时使用 LLM 提供的语义化 ID
        assert len(result["schemas"]["users"]["constraints"]) == 1

    def test_skips_non_dict_schema(self):
        llm_result = {"schemas": ["not_a_dict"]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert result["schemas"] == {}

    def test_schema_uses_name_when_id_missing(self):
        """LLM 未提供 id 时，用 name 作为 fallback 生成语义化 ID"""
        llm_result = {"schemas": [{"name": "users", "columns": []}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["schemas"]) == 1
        schema = list(result["schemas"].values())[0]
        assert schema["id"] == "users"
        assert schema["name"] == "users"

    def test_skips_schema_without_id_and_name(self):
        """既无 id 也无 name 的 schema 应被跳过"""
        llm_result = {"schemas": [{"columns": []}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert result["schemas"] == {}

    def test_no_schemas_when_option_disabled(self):
        llm_result = {"schemas": [{"id": "users", "name": "users"}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(generate_schemas=False),
            existing_config=None,
        )
        assert result["schemas"] == {}


class TestConstraintNormalization:
    def test_simple_notnull_constraint(self):
        llm_result = {"constraints": [{"type": "notnull", "table_id": "users", "column_id": "email"}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["constraints"]) == 1
        c = list(result["constraints"].values())[0]
        assert c["type"] == "Notnull"
        assert c["refs"]["column_id"] == "email"
        assert c["version"] == 2
        assert c["enabled"] is True

    def test_unique_constraint_with_column_ids(self):
        llm_result = {
            "constraints": [
                {
                    "type": "unique",
                    "table_id": "users",
                    "column_ids": ["email", "username"],
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["refs"]["column_ids"] == ["email", "username"]

    def test_foreign_key_constraint_v2_format(self):
        llm_result = {
            "constraints": [
                {
                    "type": "ForeignKey",
                    "refs": {
                        "from_table_id": "orders",
                        "from_column_id": "user_id",
                        "to_table_id": "users",
                        "to_column_id": "id",
                    },
                    "params": {},
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["refs"]["from_table_id"] == "orders"
        assert c["refs"]["to_column_id"] == "id"

    def test_allowed_values_constraint_v2_format(self):
        llm_result = {
            "constraints": [
                {
                    "type": "AllowedValues",
                    "refs": {"table_id": "users", "column_id": "status"},
                    "params": {"allowed_values": ["active", "inactive"]},
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["params"]["allowed_values"] == ["active", "inactive"]

    def test_range_constraint(self):
        llm_result = {
            "constraints": [
                {
                    "type": "Range",
                    "table_id": "products",
                    "column_id": "price",
                    "min": 0,
                    "max": 9999,
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["params"]["min"] == 0
        assert c["params"]["max"] == 9999

    def test_conditional_constraint(self):
        llm_result = {
            "constraints": [
                {
                    "type": "conditional",
                    "table_id": "users",
                    "column_id": "status",
                    "then_column_id": "reason",
                    "if_conditions": [{"column": "status", "op": "==", "value": "inactive"}],
                    "if_logic": "and",
                    "then_value": "required",
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["refs"]["then_column_id"] == "reason"
        assert c["params"]["then_value"] == "required"

    def test_scripted_constraint(self):
        llm_result = {
            "constraints": [
                {
                    "type": "scripted",
                    "table_id": "users",
                    "column_id": "email",
                    "expression": "value.contains('@')",
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["params"]["expression"] == "value.contains('@')"

    def test_v2_format_constraint_passthrough(self):
        llm_result = {
            "constraints": [
                {
                    "type": "NotNull",
                    "refs": {"table_id": "users", "column_id": "email"},
                    "params": {},
                }
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        c = list(result["constraints"].values())[0]
        assert c["type"] == "NotNull"
        assert c["refs"]["table_id"] == "users"

    def test_constraint_id_conflict_resolution(self):
        llm_result = {
            "constraints": [
                {"type": "NotNull", "table_id": "users", "column_id": "email"},
                {"type": "NotNull", "table_id": "users", "column_id": "email"},
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["constraints"]) == 2
        ids = list(result["constraints"].keys())
        assert ids[0] != ids[1]

    def test_skips_non_dict_constraint(self):
        llm_result = {"constraints": ["bad"]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["warnings"]) == 1

    def test_skips_constraint_without_type(self):
        llm_result = {"constraints": [{"table_id": "users"}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["constraints"]) == 0

    def test_no_constraints_when_option_disabled(self):
        llm_result = {"constraints": [{"type": "NotNull", "table_id": "u", "column_id": "e"}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(generate_constraints=False),
            existing_config=None,
        )
        assert result["constraints"] == {}


class TestRegexNormalization:
    def test_basic_regex_node(self):
        llm_result = {"regex_nodes": [{"name": "邮箱格式", "pattern": "^[^@]+@[^@]+$"}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["regex_nodes"]) == 1
        r = list(result["regex_nodes"].values())[0]
        assert r["version"] == 2
        assert r["pattern"] == "^[^@]+@[^@]+$"
        assert r["match_mode"] == "full"
        assert r["enabled"] is True

    def test_regex_with_existing_id(self):
        llm_result = {
            "regex_nodes": [
                {"id": "email_regex", "name": "邮箱", "pattern": ".*"},
                {"id": "email_regex", "name": "邮箱2", "pattern": ".*"},
            ]
        }
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert len(result["regex_nodes"]) == 2
        ids = list(result["regex_nodes"].keys())
        assert ids[0] != ids[1]

    def test_skips_non_dict_regex(self):
        llm_result = {"regex_nodes": ["bad"]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(),
            existing_config=None,
        )
        assert result["regex_nodes"] == {}

    def test_no_regex_when_option_disabled(self):
        llm_result = {"regex_nodes": [{"name": "test", "pattern": ".*"}]}
        result = build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(generate_regex_nodes=False),
            existing_config=None,
        )
        assert result["regex_nodes"] == {}
