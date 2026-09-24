# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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

    def test_table_level_constraint_without_column_does_not_crash(self):
        """LLM 输出表级约束（无 column_id/column_ids）不再 IndexError 崩溃，以 unknown 兜底生成"""
        llm_result = {
            "constraints": [{"type": "Range", "table_id": "users", "min": 0, "max": 100}],
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
        assert result["success"] is True
        assert len(result["constraints"]) == 1
        cid = next(iter(result["constraints"]))
        assert "unknown" in cid

    def test_v2_refs_with_explicit_empty_column_ids_does_not_crash(self):
        """V2 格式显式空 column_ids 列表不再 IndexError（.get 默认值对空列表不生效的坑）"""
        llm_result = {
            "constraints": [{"type": "Range", "refs": {"table_id": "users", "column_ids": []}, "params": {"min": 0}}],
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
        assert result["success"] is True
        assert len(result["constraints"]) == 1

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
                    "columns": [{"id": "id", "name": "id", "type": "integer"}],
                    "constraints": [{"id": "id_notnull", "type": "NotNull", "column_id": "id"}],
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
        # 无 profiling 数据时使用 LLM 提供的语义化 ID；内嵌约束规范化为 ConstraintItem 形态
        items = result["schemas"]["users"]["constraints"]
        assert len(items) == 1
        assert items[0]["type"] == "NotNull"
        assert items[0]["column"] == "id"

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
        assert c["type"] == "NotNull"
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
                    "then_condition": {"operator": "not_null"},
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
        assert c["params"]["then_condition"] == {"operator": "not_null"}

    def test_charset_and_boundary_passthrough(self):
        """生成链路简化格式：charset_mode / boundary_mode / DateLogic 计算参数落盘。"""
        llm_result = {
            "constraints": [
                {"type": "charset", "table_id": "users", "column_id": "nickname", "charset_mode": "chinese_mixed"},
                {
                    "type": "range",
                    "table_id": "users",
                    "column_id": "age",
                    "min": 0,
                    "max": 150,
                    "boundary_mode": "exclusive",
                },
                {
                    "type": "DateLogic",
                    "table_id": "users",
                    "column_id": "birth_date",
                    "logic_mode": "calculation",
                    "calculation_type": "age",
                    "target_value": 18,
                },
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
        constraints = list(result["constraints"].values())
        by_type = {c["type"]: c for c in constraints}
        assert by_type["Charset"]["params"] == {"charset_mode": "chinese_mixed"}
        assert by_type["Range"]["params"]["boundary_mode"] == "exclusive"
        assert by_type["DateLogic"]["params"]["calculation_type"] == "age"
        assert by_type["DateLogic"]["params"]["target_value"] == 18

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


class TestInlineConstraints:
    """内嵌约束规范化：内嵌优先约定的落地行为。

    内嵌定义统一转为 ConstraintItem 形态（column 承载全限定列名，供加载器
    按列名精确解析），Composite 降级独立，跨形态语义去重防双重校验。
    """

    def _users_llm_result(self, inline=None, standalone=None):
        columns = [
            {"id": "email", "name": "邮箱", "type": "string"},
            {"id": "status", "name": "状态", "type": "string"},
        ]
        schema = {"id": "users", "name": "users", "columns": columns}
        if inline is not None:
            schema["constraints"] = inline
        llm = {"schemas": [schema]}
        if standalone is not None:
            llm["constraints"] = standalone
        return llm

    def _build(self, llm_result, **option_overrides):
        return build_config(
            project_id="p",
            project_name="P",
            config_path=None,
            profiling_data=[],
            llm_result=llm_result,
            options=_make_options(**option_overrides),
            existing_config=None,
        )

    def test_inline_simplified_form_normalizes_to_constraint_item(self):
        """简化形态内嵌（column_id 引用）归一为 ConstraintItem，列 id 解析为列名。"""
        llm = self._users_llm_result(
            inline=[
                {"id": "email_notnull", "type": "NotNull", "column_id": "email"},
                {
                    "id": "status_allowed",
                    "type": "AllowedValues",
                    "column_id": "status",
                    "allowed_values": ["A", "B"],
                },
            ]
        )
        result = self._build(llm)
        schema = result["schemas"]["users"]
        assert len(schema["constraints"]) == 2
        first = schema["constraints"][0]
        assert first["type"] == "NotNull"
        # 加载器按列名精确解析内嵌引用，column 必须归一为列名而非列 id
        assert first["column"] == "邮箱"
        second = schema["constraints"][1]
        assert second["params"]["allowed_values"] == ["A", "B"]
        # 内嵌约束不进 manifest 独立引用
        assert result["manifest"]["constraints"] == []

    def test_inline_refs_form_supported(self):
        llm = self._users_llm_result(
            inline=[
                {
                    "id": "email_notnull",
                    "type": "NotNull",
                    "enabled": True,
                    "refs": {"table_id": "users", "column_id": "email"},
                    "params": {},
                }
            ]
        )
        result = self._build(llm)
        items = result["schemas"]["users"]["constraints"]
        assert len(items) == 1
        assert items[0]["column"] == "邮箱"
        assert items[0]["type"] == "NotNull"

    def test_inline_range_params_preserved(self):
        llm = self._users_llm_result(
            inline=[
                {
                    "id": "amount_range",
                    "type": "Range",
                    "column_id": "status",
                    "min": 0,
                    "max": 100,
                    "boundary_mode": "inclusive",
                }
            ]
        )
        result = self._build(llm)
        item = result["schemas"]["users"]["constraints"][0]
        assert item["params"]["min"] == 0
        assert item["params"]["max"] == 100
        assert item["params"]["boundary_mode"] == "inclusive"

    def test_inline_unique_resolves_all_columns(self):
        llm = {
            "schemas": [
                {
                    "id": "users",
                    "name": "users",
                    "columns": [
                        {"id": "a", "name": "甲", "type": "string"},
                        {"id": "b", "name": "乙", "type": "string"},
                    ],
                    "constraints": [{"id": "ab_unique", "type": "Unique", "column_ids": ["a", "b"]}],
                }
            ]
        }
        result = self._build(llm)
        item = result["schemas"]["users"]["constraints"][0]
        assert item["columns"] == ["甲", "乙"]

    def test_inline_unknown_column_dropped_with_warning(self):
        llm = self._users_llm_result(inline=[{"id": "ghost_notnull", "type": "NotNull", "column_id": "ghost"}])
        result = self._build(llm)
        assert result["schemas"]["users"]["constraints"] == []
        assert any("无法解析" in w for w in result["warnings"])

    def test_inline_composite_demoted_to_standalone(self):
        """Composite 不支持内嵌：自动转为独立约束并告警。"""
        llm = self._users_llm_result(
            inline=[
                {
                    "id": "combo",
                    "type": "Composite",
                    "column_id": "email",
                    "logic": "all",
                    "sub_constraints": [{"type": "NotNull", "column_id": "email"}],
                }
            ]
        )
        result = self._build(llm)
        assert result["schemas"]["users"]["constraints"] == []
        assert len(result["constraints"]) == 1
        standalone = next(iter(result["constraints"].values()))
        assert standalone["type"] == "Composite"
        assert standalone["params"]["sub_constraints"]
        assert any("转为独立" in w for w in result["warnings"])

    def test_duplicate_rule_standalone_and_inline_keeps_standalone(self):
        """同 (表, 列, 类型) 的独立+内嵌重复：保留独立，丢弃内嵌并告警。"""
        llm = self._users_llm_result(
            inline=[{"id": "email_notnull", "type": "NotNull", "column_id": "email"}],
            standalone=[{"type": "NotNull", "table_id": "users", "column_id": "email"}],
        )
        result = self._build(llm)
        assert result["schemas"]["users"]["constraints"] == []
        assert len(result["constraints"]) == 1
        assert any("忽略重复约束" in w for w in result["warnings"])

    def test_inline_foreign_key_resolves_target_columns(self):
        """内嵌外键：源/目标列按各表列定义归一为列名，to_table 为规范 Schema ID。"""
        llm = {
            "schemas": [
                {
                    "id": "users",
                    "name": "users",
                    "columns": [{"id": "email", "name": "邮箱", "type": "string"}],
                },
                {
                    "id": "orders",
                    "name": "orders",
                    "columns": [{"id": "uid", "name": "用户ID", "type": "string"}],
                    "constraints": [
                        {
                            "id": "fk_orders_users",
                            "type": "ForeignKey",
                            "from_table_id": "orders",
                            "from_column_id": "uid",
                            "to_table_id": "users",
                            "to_column_id": "email",
                        }
                    ],
                },
            ]
        }
        result = self._build(llm)
        item = result["schemas"]["orders"]["constraints"][0]
        assert item["from_column"] == "用户ID"
        assert item["to_table"] == "users"
        assert item["to_column"] == "邮箱"

    def test_inline_conditional_keeps_refs_in_params(self):
        """内嵌条件约束：THEN/IF 引用是列 ID 语义，保留在 params（加载器从 params 提取）。"""
        llm = self._users_llm_result(
            inline=[
                {
                    "id": "cond",
                    "type": "Conditional",
                    "then_column_id": "status",
                    "if_conditions": [{"if_column_id": "email", "operator": "eq", "value": "a"}],
                    "if_logic": "and",
                    "then_condition": {"operator": "not_null"},
                }
            ]
        )
        result = self._build(llm)
        item = result["schemas"]["users"]["constraints"][0]
        assert item["params"]["then_column_id"] == "status"
        assert item["params"]["if_conditions"] == [{"if_column_id": "email", "operator": "eq", "value": "a"}]
        assert item["params"]["if_logic"] == "and"
        assert item["params"]["then_condition"] == {"operator": "not_null"}

    def test_refine_roundtrip_constraint_item_shape_preserved(self):
        """refine 回流的 ConstraintItem 形态（column 承载列名、参数在 params）不丢参数。"""
        llm = self._users_llm_result(
            inline=[
                {
                    "id": "status_allowed",
                    "type": "AllowedValues",
                    "column": "状态",
                    "enabled": True,
                    "params": {"allowed_values": ["A"]},
                }
            ]
        )
        result = self._build(llm)
        items = result["schemas"]["users"]["constraints"]
        assert len(items) == 1
        assert items[0]["column"] == "状态"
        assert items[0]["params"]["allowed_values"] == ["A"]
        assert not any("无法解析" in w for w in result["warnings"])

    def test_generate_constraints_false_skips_inline(self):
        llm = self._users_llm_result(inline=[{"id": "email_notnull", "type": "NotNull", "column_id": "email"}])
        result = self._build(llm, generate_constraints=False)
        assert result["schemas"]["users"]["constraints"] == []

    def test_same_column_type_duplicates_deduped(self):
        """同列同类型的多条内嵌约束按语义键去重，不产生重复规则。"""
        llm = self._users_llm_result(
            inline=[
                {"id": "s1", "type": "AllowedValues", "column_id": "status", "allowed_values": ["A"]},
                {"id": "s2", "type": "AllowedValues", "column_id": "status", "allowed_values": ["B"]},
            ]
        )
        result = self._build(llm)
        assert len(result["schemas"]["users"]["constraints"]) == 1
        assert any("忽略重复约束" in w for w in result["warnings"])
