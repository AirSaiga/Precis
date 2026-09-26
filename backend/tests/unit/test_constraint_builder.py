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
"""
@fileoverview 约束构建器和内联批量处理覆盖测试

覆盖目标:
- constraint_builder.py: _build_constraint_refs, _build_constraint_params
- inline_batch.py: _collect_target_schema_id, _is_inline_action
"""


def _eval_in_scripted_sandbox(expression: str, *, value: object, row: dict | None = None) -> object:
    """在与 ScriptedConstraint.validate 相同装配的沙箱内求值表达式（真实路径，非 mock）。

    镜像 scripted.py 的运行时装配：SAFE_FUNCTIONS 白名单 + re_match(fullmatch 语义)，
    变量只有 value/row——用于验证生成表达式在真实沙箱可执行且无注入逃逸。
    """
    import re

    from simpleeval import SimpleEval

    from app.shared.domain.eval_sandbox import SAFE_FUNCTIONS

    evaluator = SimpleEval(names={"value": value, "row": row or {}})
    evaluator.functions.update(dict(SAFE_FUNCTIONS))
    evaluator.functions["re_match"] = lambda p, s: re.fullmatch(p, s) is not None
    return evaluator.eval(expression)


class TestBuildConstraintRefs:
    def test_notnull_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        refs = _build_constraint_refs(
            "NOT_NULL", "users", "email", {"targetNodeId": "sc_users", "targetColumnId": "c1"}
        )
        assert refs["table_id"] == "sc_users"
        assert refs["column_id"] == "c1"

    def test_unique_refs(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        refs = _build_constraint_refs("UNIQUE", "users", "email", {"targetNodeId": "sc_users", "targetColumnId": "c1"})
        assert refs["table_id"] == "sc_users"
        assert refs["column_ids"] == ["c1"]

    def test_unique_multi_column_refs(self):
        """多列联合唯一：targetColumns 数组 → column_ids 列表。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        spec = {"targetNodeId": "sc_orders", "targetColumnIds": ["order_id", "line_no"]}
        refs = _build_constraint_refs("UNIQUE", "orders", "", spec)
        assert refs == {"table_id": "sc_orders", "column_ids": ["order_id", "line_no"]}

    def test_unique_multi_column_by_names(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_refs

        spec = {"targetNodeId": "sc_orders", "targetColumns": ["order_id", "line_no"]}
        refs = _build_constraint_refs("UNIQUE", "orders", "", spec)
        assert refs["column_ids"] == ["order_id", "line_no"]

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
        # 必须经沙箱白名单函数 re_match（fullmatch）——旧式 "re.match(...)" 在沙箱内
        # re 未定义，逐行 SCRIPTED_EXECUTION_ERROR；且不得 re.escape（会把元字符当字面量）
        assert params["expression"] == f"re_match({r'^\d+$'!r}, str(value))"

    def test_scripted_pattern_with_single_quote(self) -> None:
        """回归：pattern 含单引号，生成表达式必须在真实沙箱内可执行且无法逃逸字面量。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("REGEX", {"params": {"pattern": "o'clock"}})
        compile(params["expression"], "<expr>", "exec")
        # 注入防护：引号被 repr 封闭在字符串字面量内，表达式按"字面 pattern"求值
        assert _eval_in_scripted_sandbox(params["expression"], value="o'clock") is True
        assert _eval_in_scripted_sandbox(params["expression"], value="o'clock now") is False

    def test_scripted_pattern_with_double_quote(self) -> None:
        """回归：pattern 含双引号，repr 字面量同样安全且语义不变。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("REGEX", {"params": {"pattern": 'say "hi"'}})
        compile(params["expression"], "<expr>", "exec")
        assert _eval_in_scripted_sandbox(params["expression"], value='say "hi"') is True
        assert _eval_in_scripted_sandbox(params["expression"], value='say "hi" there') is False

    def test_scripted_with_expression(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("REGEX", {"params": {"expression": "value > 0"}})
        assert params["expression"] == "value > 0"

    def test_date_logic(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("DATE_LOGIC", {"params": {"logicMode": "compare", "compareOp": "gt"}})
        assert params["logic_mode"] == "compare"
        assert params["compare_op"] == "gt"

    def test_date_logic_range(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params(
            "DATE_LOGIC",
            {
                "params": {
                    "logicMode": "compare",
                    "compareOp": "range",
                    "referenceDate": "2024-01-01",
                    "referenceDateEnd": "2024-12-31",
                }
            },
        )
        assert params["logic_mode"] == "compare"
        assert params["compare_op"] == "range"
        assert params["reference_date"] == "2024-01-01"
        assert params["reference_date_end"] == "2024-12-31"

    def test_conditional_then_condition_dsl(self):
        """camelCase DSL 归一为运行时消费的 snake_case 键（历史缺陷：写 then_value 无消费方）。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params(
            "CONDITIONAL",
            {"params": {"thenCondition": {"operator": "greater_than", "value": 1000, "refColumn": "limit"}}},
        )
        assert params == {"then_condition": {"operator": "greater_than", "value": 1000, "ref_column": "limit"}}

    def test_conditional_then_condition_in_values(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params(
            "CONDITIONAL", {"params": {"thenCondition": {"operator": "in", "values": ["a", "b"]}}}
        )
        assert params == {"then_condition": {"operator": "in", "values": ["a", "b"]}}

    def test_conditional_then_condition_str(self):
        """字符串形态：已注册条件函数名（如 is_not_empty）原样透传。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("CONDITIONAL", {"params": {"thenCondition": "is_not_empty"}})
        assert params == {"then_condition": "is_not_empty"}

    def test_conditional_then_condition_snake_compat(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("CONDITIONAL", {"params": {"then_condition": {"operator": "not_null"}}})
        assert params == {"then_condition": {"operator": "not_null"}}

    def test_conditional_then_value_rejected(self):
        """旧契约回归锁定：thenValue 已废弃，缺 thenCondition 必须失败而非静默落盘残缺约束。"""
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="thenCondition"):
            _build_constraint_params("CONDITIONAL", {"params": {"thenValue": 42}})

    def test_conditional_invalid_operator_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="operator"):
            _build_constraint_params("CONDITIONAL", {"params": {"thenCondition": {"operator": "contains"}}})

    def test_conditional_in_requires_list(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="in"):
            _build_constraint_params("CONDITIONAL", {"params": {"thenCondition": {"operator": "in", "value": "a"}}})

    def test_charset_mode_mapping(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        for mode in ("ascii", "chinese", "chinese_mixed"):
            params = _build_constraint_params("CHARSET", {"params": {"charsetMode": mode}})
            assert params == {"charset_mode": mode}

    def test_charset_mode_snake_compat(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("CHARSET", {"params": {"charset_mode": "chinese"}})
        assert params == {"charset_mode": "chinese"}

    def test_charset_missing_rejected(self):
        """历史缺陷回归：缺 charsetMode 曾静默默认 ascii（中文约束建成 ascii 约束→系统性误报）。"""
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="charsetMode"):
            _build_constraint_params("CHARSET", {"params": {}})

    def test_charset_invalid_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="charsetMode"):
            _build_constraint_params("CHARSET", {"params": {"charsetMode": "utf8"}})

    def test_range_boundary_mode(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("RANGE", {"params": {"min": 0, "max": 10, "boundaryMode": "exclusive"}})
        assert params == {"min": 0, "max": 10, "boundary_mode": "exclusive"}

    def test_range_boundary_mode_snake_compat(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("RANGE", {"params": {"min": 0, "boundary_mode": "exclusive"}})
        assert params["boundary_mode"] == "exclusive"

    def test_range_boundary_mode_invalid_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="boundaryMode"):
            _build_constraint_params("RANGE", {"params": {"min": 0, "boundaryMode": "closed"}})

    def test_date_logic_calculation_age(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params(
            "DATE_LOGIC",
            {"params": {"logicMode": "calculation", "calculationType": "age", "targetValue": 18}},
        )
        assert params["logic_mode"] == "calculation"
        assert params["calculation_type"] == "age"
        assert params["target_value"] == 18

    def test_date_logic_calculation_days_diff(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params(
            "DATE_LOGIC",
            {
                "params": {
                    "logicMode": "calculation",
                    "calculationType": "days_diff",
                    "targetColumn": "ship_date",
                    "targetValue": 3,
                }
            },
        )
        assert params["calculation_type"] == "days_diff"
        assert params["target_column"] == "ship_date"
        assert params["target_value"] == 3

    def test_date_logic_calculation_missing_calculation_type_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="calculationType"):
            _build_constraint_params("DATE_LOGIC", {"params": {"logicMode": "calculation"}})

    def test_date_logic_days_diff_missing_target_column_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="targetColumn"):
            _build_constraint_params(
                "DATE_LOGIC",
                {"params": {"logicMode": "calculation", "calculationType": "days_diff", "targetValue": 3}},
            )

    def test_composite_expands_sub_constraints(self):
        """subConstraints 简化列表展开为运行时消费的完整子约束文件 dict 列表。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        spec = {
            "targetNodeId": "sc_users",
            "params": {
                "logic": "all",
                "subConstraints": [
                    {"type": "NOT_NULL", "targetColumn": "email"},
                    {"type": "UNIQUE", "targetColumn": "email"},
                ],
            },
        }
        params = _build_constraint_params("COMPOSITE", spec, "users", "email", "", "comp_id")
        assert params["logic"] == "all"
        assert len(params["sub_constraints"]) == 2
        sub1, sub2 = params["sub_constraints"]
        assert sub1 == {
            "version": 2,
            "id": "comp_id_sub_1",
            "type": "NotNull",
            "enabled": True,
            "refs": {"table_id": "sc_users", "column_id": "email"},
            "params": {},
        }
        assert sub2["id"] == "comp_id_sub_2"
        assert sub2["refs"] == {"table_id": "sc_users", "column_ids": ["email"]}

    def test_composite_sub_params_mapped(self):
        """子约束 params 走完整映射（如 Range boundary_mode），不是原样透传。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        spec = {
            "targetNodeId": "t1",
            "params": {
                "subConstraints": [
                    {"type": "Range", "targetColumn": "amount", "params": {"min": 0, "boundaryMode": "exclusive"}}
                ]
            },
        }
        params = _build_constraint_params("COMPOSITE", spec, "orders", "amount", "", "c1")
        assert params["sub_constraints"][0]["params"] == {"min": 0, "max": None, "boundary_mode": "exclusive"}

    def test_composite_empty_rejected(self):
        """历史缺陷回归：空子约束在引擎侧恒真（no-op 假通过），必须拒绝落盘。"""
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        with pytest.raises(ValueError, match="subConstraints"):
            _build_constraint_params("COMPOSITE", {"params": {}})

    def test_composite_nested_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        spec = {"params": {"subConstraints": [{"type": "Composite", "targetColumn": "x"}]}}
        with pytest.raises(ValueError, match="嵌套"):
            _build_constraint_params("COMPOSITE", spec)

    def test_composite_invalid_logic_rejected(self):
        import pytest

        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        spec = {"params": {"logic": "xor", "subConstraints": [{"type": "NotNull", "targetColumn": "x"}]}}
        with pytest.raises(ValueError, match="logic"):
            _build_constraint_params("COMPOSITE", spec)

    def test_unknown_type(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("UnknownType", {})
        assert params == {}

    def test_notnull_empty_params(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_constraint_params

        params = _build_constraint_params("NOT_NULL", {})
        assert params == {}


class TestBuildInlineConstraintItem:
    """schema 内联约束项构建（update_yaml_config 与 process_inline_batch 共用路径）。"""

    def test_conditional_inline_params(self):
        """Conditional 内联：if_logic/if_conditions/then_column_id 写入 params（加载期提取到 refs）。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_inline_constraint_item

        spec = {
            "targetNodeId": "sc_users",
            "targetColumn": "id_card",
            "params": {
                "ifConditions": [{"ifColumnId": "country", "operator": "eq", "value": "CN"}],
                "thenCondition": {"operator": "not_null"},
            },
        }
        item = _build_inline_constraint_item(
            "Conditional", spec, "col_3", [{"id": "col_3", "name": "id_card"}], "users", "id_card", "", "cond_1"
        )
        assert item["column"] == "col_3"
        assert item["params"]["then_condition"] == {"operator": "not_null"}
        assert item["params"]["if_logic"] == "and"
        assert item["params"]["if_conditions"] == [
            {"if_column_id": "country", "operator": "eq", "value": "CN", "values": None}
        ]
        assert item["params"]["then_column_id"] == "col_3"

    def test_foreign_key_inline_top_level_fields(self):
        """ForeignKey 内联：目标表/列必须落 ConstraintItem 顶层字段（params 里无人消费）。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_inline_constraint_item

        spec = {
            "targetNodeId": "sc_orders",
            "targetColumn": "user_id",
            "params": {"toTableId": "sc_users", "toColumnId": "id"},
        }
        item = _build_inline_constraint_item(
            "ForeignKey", spec, "col_9", [{"id": "col_9", "name": "user_id"}], "orders", "user_id", "", "fk_1"
        )
        assert item["from_column"] == "col_9"
        assert item["to_table"] == "sc_users"
        assert item["to_column"] == "id"

    def test_unique_multi_column_uses_columns(self):
        """多列 Unique 内联：columns 列表与 column 互斥。"""
        from app.shared.services.llm.constraints.constraint_builder import _build_inline_constraint_item

        schema_columns = [
            {"id": "order_id", "name": "订单号"},
            {"id": "line_no", "name": "行号"},
        ]
        spec = {"targetNodeId": "sc_orders", "targetColumns": ["订单号", "line_no"]}
        item = _build_inline_constraint_item("Unique", spec, "", schema_columns, "orders", "", "", "uniq_1")
        assert "column" not in item
        assert item["columns"] == ["order_id", "line_no"]

    def test_charset_inline_params(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_inline_constraint_item

        spec = {"targetColumn": "nickname", "params": {"charsetMode": "chinese_mixed"}}
        item = _build_inline_constraint_item(
            "Charset", spec, "c1", [{"id": "c1", "name": "nickname"}], "users", "nickname", "", "cs_1"
        )
        assert item["params"] == {"charset_mode": "chinese_mixed"}

    def test_empty_params_omitted(self):
        from app.shared.services.llm.constraints.constraint_builder import _build_inline_constraint_item

        spec = {"targetColumn": "email"}
        item = _build_inline_constraint_item(
            "NotNull", spec, "c1", [{"id": "c1", "name": "email"}], "users", "email", "", "nn_1"
        )
        assert "params" not in item


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
