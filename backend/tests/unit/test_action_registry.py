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
"""@fileoverview 动作注册表（单一事实源）单元测试

验证注册表的派生属性自洽性，以及各消费方（validator/processor/parser/apply_actions）
的集合确实从注册表派生，而非本地硬编码。

测试目标（行为）：
- 注册表派生属性覆盖全部动作、分类互斥且并集等于全集
- spec 字段映射、读写分类、子类型白名单自洽
- 消费方的白名单与注册表一致（防漂移回归）
"""

from __future__ import annotations

from app.shared.domain.schema.builder import TYPE_REGISTRY
from app.shared.services.llm.actions import registry
from app.shared.services.llm.actions.action_validator import ActionValidator
from app.shared.services.llm.chat.response_parser import ActionParser

# =============================================================================
# 注册表派生属性自洽性
# =============================================================================


def test_action_count_matches_registry_size():
    """ACTION_COUNT 等于 ACTIONS 字典大小。"""
    assert registry.ACTION_COUNT == len(registry.ACTIONS)


def test_all_action_types_equals_actions_keys():
    """ALL_ACTION_TYPES 与 ACTIONS 的键完全一致。"""
    assert set(registry.ALL_ACTION_TYPES) == set(registry.ACTIONS.keys())


def test_categories_partition_all_actions():
    """BY_CATEGORY 各分类互斥，且并集等于全部动作（无遗漏无重叠）。"""
    union = set()
    for types in registry.BY_CATEGORY.values():
        union |= types
    assert union == set(registry.ALL_ACTION_TYPES)
    # 互斥：任意两分类无交集
    cats = list(registry.BY_CATEGORY.values())
    for i in range(len(cats)):
        for j in range(i + 1, len(cats)):
            assert cats[i].isdisjoint(cats[j]), "动作分类存在重叠"


def test_read_write_partition():
    """READ_ONLY 与 WRITE 互斥且并集等于全集。"""
    assert registry.READ_ONLY_ACTION_TYPES.isdisjoint(registry.WRITE_ACTION_TYPES)
    assert registry.READ_ONLY_ACTION_TYPES | registry.WRITE_ACTION_TYPES == set(registry.ALL_ACTION_TYPES)


def test_validate_project_and_add_to_canvas_are_read_only():
    """已知只读动作确实归入只读集合。"""
    assert "VALIDATE_PROJECT" in registry.READ_ONLY_ACTION_TYPES
    assert "ADD_TO_CANVAS" in registry.READ_ONLY_ACTION_TYPES


def test_spec_field_for_covers_all_actions():
    """SPEC_FIELD_FOR 覆盖全部动作键。"""
    assert set(registry.SPEC_FIELD_FOR.keys()) == set(registry.ALL_ACTION_TYPES)


def test_spec_field_mapping_known_values():
    """spec 字段映射与已知约定一致。"""
    assert registry.SPEC_FIELD_FOR["ADD_SCHEMA"] == "schemaSpec"
    assert registry.SPEC_FIELD_FOR["ADD_TO_CANVAS"] == "canvasSpec"
    assert registry.SPEC_FIELD_FOR["ADD_CONSTRAINT_NODE"] == "constraintSpec"
    assert registry.SPEC_FIELD_FOR["UPDATE_SETTINGS"] == "settingsSpec"


def test_get_action_def_returns_none_for_unknown():
    """未知动作返回 None。"""
    assert registry.get_action_def("NONEXISTENT") is None


def test_is_read_only_defaults_false_for_unknown():
    """未知动作视为写（保守）。"""
    assert registry.is_read_only("NONEXISTENT") is False


# =============================================================================
# 子类型白名单自洽性
# =============================================================================


def test_constraint_types_and_aliases_disjoint():
    """标准约束名与别名不重叠。"""
    assert registry.CONSTRAINT_TYPES.isdisjoint(registry.CONSTRAINT_TYPE_ALIASES.keys())


def test_all_constraint_types_is_union():
    """ALL_CONSTRAINT_TYPES = 标准 ∪ 别名。"""
    assert registry.ALL_CONSTRAINT_TYPES == registry.CONSTRAINT_TYPES | frozenset(
        registry.CONSTRAINT_TYPE_ALIASES.keys()
    )


def test_transform_sub_types_count():
    """转换子类型白名单含 22 种。"""
    assert len(registry.TRANSFORM_SUB_TYPES) == 22
    assert "CastType" in registry.TRANSFORM_SUB_TYPES


def test_data_types_match_runtime_type_registry():
    """DATA_TYPES 与运行时支持的 6 种列类型一致（防白名单/提示词教错类型）。

    运行时权威是 domain/schema/builder.py 的 TYPE_REGISTRY——datetime/time 不在其中，
    build_type_from_config 对未知类型直接 raise；schema_inference 的清单是一致参考。
    曾漂移：白名单多出 datetime/time，AI 写盘成功但之后每次校验都失败。
    """
    from app.shared.services.schema_inference import DATA_TYPES as INFERENCE_DATA_TYPES

    assert registry.DATA_TYPES == frozenset(INFERENCE_DATA_TYPES)
    assert registry.DATA_TYPES == frozenset({"string", "integer", "float", "decimal", "boolean", "date"})
    # 权威断言：白名单里每个类型都是 TYPE_REGISTRY 的合法 key（注册表 key 含大小写
    # 别名与表达式类型，DATA_TYPES 的 6 个小写名必须逐一命中）
    assert all(t in TYPE_REGISTRY for t in registry.DATA_TYPES)
    assert "datetime" not in registry.DATA_TYPES
    assert "time" not in registry.DATA_TYPES


# =============================================================================
# 消费方一致性（防漂移回归）
# =============================================================================


def test_action_parser_whitelists_match_registry():
    """ActionParser 的白名单从注册表派生（防本地硬编码回归）。"""
    assert set(ActionParser.VALID_ACTION_TYPES) == set(registry.ALL_ACTION_TYPES)
    assert set(ActionParser.VALID_CONSTRAINT_TYPES) == set(registry.ALL_CONSTRAINT_TYPES)
    assert set(ActionParser.VALID_TRANSFORM_TYPES) == set(registry.TRANSFORM_SUB_TYPES)


def test_action_validator_whitelists_match_registry():
    """ActionValidator 的白名单从注册表派生。"""
    assert set(ActionValidator.VALID_SCHEMA_TYPES) == registry.SCHEMA_ACTION_TYPES
    assert set(ActionValidator.VALID_REGEX_TYPES) == registry.REGEX_ACTION_TYPES
    assert set(ActionValidator.VALID_TRANSFORM_TYPES) == registry.TRANSFORM_ACTION_TYPES
    assert set(ActionValidator.VALID_CONSTRAINT_TYPES) == set(registry.ALL_CONSTRAINT_TYPES)
    assert set(ActionValidator.VALID_SETTINGS_CATEGORIES) == registry.SETTINGS_CATEGORIES


# =============================================================================
# 提示词文本派生（消灭手写动作清单漂移）
# =============================================================================


def test_build_action_type_list_contains_all_categories():
    """build_action_type_list_text 覆盖全部 7 个 category。"""
    text = registry.build_action_type_list_text()
    # 每个 category 的标签都应出现
    for label in ["约束", "Schema", "正则", "转换", "设置", "校验", "显示到画布"]:
        assert label in text
    # 全部 15 个动作类型都应出现
    for action_type in registry.ALL_ACTION_TYPES:
        assert action_type in text, f"动作 {action_type} 未出现在提示词清单中"


def test_build_action_type_list_marks_canvas_readonly():
    """ADD_TO_CANVAS 在清单中标注"不写盘"。"""
    text = registry.build_action_type_list_text()
    assert "ADD_TO_CANVAS" in text
    assert "不写盘" in text


def test_build_spec_field_mapping_covers_all_specs():
    """build_spec_field_mapping_text 覆盖全部 spec 字段。"""
    text = registry.build_spec_field_mapping_text()
    for spec_field in ["constraintSpec", "schemaSpec", "regexSpec", "transformSpec", "settingsSpec", "canvasSpec"]:
        assert spec_field in text, f"spec 字段 {spec_field} 未出现在映射清单中"


def test_build_data_type_list_contains_all_types():
    """build_data_type_list_text 覆盖全部数据类型且不含运行时不支持的类型。"""
    text = registry.build_data_type_list_text()
    for data_type in registry.DATA_TYPES:
        assert data_type in text, f"数据类型 {data_type} 未出现在提示词清单中"
    assert "datetime" not in text
    assert "time" not in text


def test_chat_system_prompt_data_types_derived_from_registry():
    """chat_system_prompt 的数据类型清单从注册表派生（防手写漂移回归）。"""
    from app.shared.services.llm.chat.chat_system_prompt import SYSTEM_PROMPT_CORE

    assert f"支持的数据类型：{registry.build_data_type_list_text()}" in SYSTEM_PROMPT_CORE
    assert "datetime" not in SYSTEM_PROMPT_CORE


def test_agent_prompt_contains_derived_action_list():
    """ChatAgentRunner 的系统提示词包含从注册表派生的动作清单（非手写）。"""
    from app.shared.services.ai.chat_agent_runner import CHAT_AGENT_SYSTEM_PROMPT

    # 派生的动作类型应出现在提示词中
    for action_type in ["ADD_TO_CANVAS", "VALIDATE_PROJECT", "ADD_SCHEMA"]:
        assert action_type in CHAT_AGENT_SYSTEM_PROMPT
    # 计数应与注册表一致（非硬编码数字）
    assert f"（{registry.ACTION_COUNT}种）" in CHAT_AGENT_SYSTEM_PROMPT


def test_agent_prompt_has_no_json_only_instructions():
    """Agent 提示词不含 JSON 直出模式的"必须返回 JSON"污染指令。"""
    from app.shared.services.ai.chat_agent_runner import CHAT_AGENT_SYSTEM_PROMPT

    # 这些是 JSON 直出模式专用指令，不应出现在 Agent 路径
    assert "绝对禁止返回纯文本" not in CHAT_AGENT_SYSTEM_PROMPT
    assert "必须返回 JSON！必须返回 JSON" not in CHAT_AGENT_SYSTEM_PROMPT


# =============================================================================
# 约束参数文档派生（chat 提示词 / MCP describe_constraints 共用单一事实源）
# =============================================================================


def test_constraint_param_schemas_cover_all_types():
    """参数文档与 CONSTRAINT_TYPES 全等——新增约束类型漏写参数文档即红。"""
    assert set(registry.CONSTRAINT_PARAM_SCHEMAS) == set(registry.CONSTRAINT_TYPES)
    # 条目的 type 字段与字典键一致（防手滑错位）
    for name, doc in registry.CONSTRAINT_PARAM_SCHEMAS.items():
        assert doc.type == name


def test_constraint_required_params_in_schemas():
    """CONSTRAINT_REQUIRED_PARAMS 的必填键必须出现在参数文档中（两份清单不矛盾）。"""
    for type_name, required_keys in registry.CONSTRAINT_REQUIRED_PARAMS.items():
        doc = registry.CONSTRAINT_PARAM_SCHEMAS[type_name]
        camel_keys = {p.camel for p in doc.params}
        for key in required_keys:
            assert key in camel_keys, f"{type_name} 的必填键 {key} 未出现在参数文档中"


def test_build_constraint_param_docs_covers_all_types_and_value_domains():
    """派生文本覆盖全部约束类型、参数键与关键值域（值域丢失会让 LLM 猜枚举）。"""
    text = registry.build_constraint_param_docs_text()
    for type_name in registry.CONSTRAINT_TYPES:
        assert f"**{type_name}**" in text, f"约束类型 {type_name} 未出现在参数文档中"
    # 全部必填/常用参数键
    for key in [
        "allowedValues",
        "min",
        "max",
        "toTableId",
        "toColumnId",
        "charsetMode",
        "subConstraints",
        "ifConditions",
        "ifLogic",
        "thenCondition",
        "expression",
        "pattern",
        "logicMode",
        "compareOp",
        "calculationType",
        "targetValue",
        "targetColumn",
        "boundaryMode",
    ]:
        assert f"`{key}`" in text, f"参数键 {key} 未出现在参数文档中"
    # 关键枚举值域逐值出现
    for value in [
        "inclusive",
        "exclusive",
        "ascii",
        "chinese",
        "chinese_mixed",
        "all",
        "any",
        "none",
        "compare",
        "calculation",
        "age",
        "days_diff",
        "and",
        "or",
    ]:
        assert f'"{value}"' in text, f"枚举值 {value} 未出现在参数文档中"


def test_constraint_param_docs_groups_render_as_sub_lines():
    """带分组的参数（DateLogic 两种模式）渲染为缩进子行。"""
    text = registry.build_constraint_param_docs_text()
    assert "  - compare 模式：`compareOp`" in text
    assert "  - calculation 模式：`calculationType`" in text


def test_constraint_param_enums_match_write_path_whitelists():
    """文档枚举值域与写盘侧/运行时白名单一致（防文档教错枚举值）。"""

    def enum_values(type_name: str, camel: str) -> set[str]:
        doc = registry.CONSTRAINT_PARAM_SCHEMAS[type_name]
        for p in doc.params:
            if p.camel == camel:
                return {v for v, _ in p.values}
        raise KeyError(f"{type_name}.{camel} 不在参数文档中")

    from app.shared.services.llm.constraints.constraint_builder import (
        _BOUNDARY_MODES,
        _CHARSET_MODES,
        _COMPOSITE_LOGIC,
    )

    assert enum_values("Range", "boundaryMode") == set(_BOUNDARY_MODES)
    assert enum_values("Charset", "charsetMode") == set(_CHARSET_MODES)
    assert enum_values("Composite", "logic") == set(_COMPOSITE_LOGIC)
    assert enum_values("Conditional", "ifLogic") == {"and", "or"}
    assert enum_values("DateLogic", "logicMode") == {"compare", "calculation"}
    assert enum_values("DateLogic", "calculationType") == {"age", "days_diff"}


def test_constraint_doc_operators_match_domain_whitelists():
    """Conditional 的 if/then 操作符说明覆盖运行时白名单的每个操作符。"""
    from app.shared.domain.constraints.conditional import _KNOWN_IF_OPERATORS
    from app.shared.services.llm.constraints.constraint_builder import _THEN_OPERATORS

    text = registry.build_constraint_param_docs_text()
    for op in _KNOWN_IF_OPERATORS | _THEN_OPERATORS:
        assert op in text, f"Conditional 操作符 {op} 未出现在参数文档中"


def test_chat_prompts_contain_derived_constraint_docs():
    """两处 chat 提示词的约束参数段从注册表派生（防回退为手抄副本）。"""
    from app.shared.services.ai.chat_agent_runner import CHAT_AGENT_SYSTEM_PROMPT
    from app.shared.services.llm.chat.chat_system_prompt import SYSTEM_PROMPT_JSON_FORMAT

    docs = registry.build_constraint_param_docs_text()
    assert docs in SYSTEM_PROMPT_JSON_FORMAT
    assert docs in CHAT_AGENT_SYSTEM_PROMPT


def test_build_constraint_param_docs_structured_snake_case_only():
    """结构化描述（MCP 用）只含 V2 文件 params 区的 snake_case 键。"""
    types = registry.build_constraint_param_docs_structured()
    assert {t["type"] for t in types} == set(registry.CONSTRAINT_TYPES)
    by_type = {t["type"]: t for t in types}
    # Range 三键齐全，boundary_mode 带值域与默认
    range_params = {p["key"]: p for p in by_type["Range"]["params"]}
    assert set(range_params) == {"min", "max", "boundary_mode"}
    assert [v["value"] for v in range_params["boundary_mode"]["values"]] == ["inclusive", "exclusive"]
    assert range_params["boundary_mode"]["default"] == "inclusive"
    # FK 的目标表/列写盘落 refs，不进 V2 params
    assert by_type["ForeignKey"]["params"] == []
    assert "to_table_id" in by_type["ForeignKey"]["refs"]
    # AI 动作层专有键（pattern）不进 V2 结构；V2 专有键（name）保留
    scripted_keys = {p["key"] for p in by_type["Scripted"]["params"]}
    assert "expression" in scripted_keys and "name" in scripted_keys
    assert "pattern" not in scripted_keys
    # NotNull/Unique 无 params
    assert by_type["NotNull"]["params"] == []
    assert by_type["Unique"]["params"] == []


def test_export_for_codegen_structure():
    """export_for_codegen 返回 JSON 兼容结构，供前端 codegen 使用。"""
    data = registry.export_for_codegen()

    # 顶层键齐全
    assert set(data.keys()) == {
        "actions",
        "all_action_types",
        "by_category",
        "read_only_action_types",
        "write_action_types",
        "constraint_types",
        "constraint_type_aliases",
    }

    # actions 数量与 ACTIONS 一致，且每项字段齐全
    assert len(data["actions"]) == len(registry.ACTIONS)
    for item in data["actions"]:
        assert set(item.keys()) == {"type", "spec_field", "category", "read_only"}

    # all_action_types 与 ALL_ACTION_TYPES 一致
    assert data["all_action_types"] == registry.ALL_ACTION_TYPES

    # by_category 各值为 sorted list（顺序稳定，便于 codegen diff）
    for cat, types in data["by_category"].items():
        assert isinstance(types, list)
        assert types == sorted(types)
        assert set(types) == registry.BY_CATEGORY[cat]

    # 只读/写盘集合互为补集
    assert set(data["read_only_action_types"]) == set(registry.READ_ONLY_ACTION_TYPES)
    assert set(data["write_action_types"]) == set(registry.WRITE_ACTION_TYPES)
    assert set(data["read_only_action_types"]).isdisjoint(data["write_action_types"])


def test_export_for_codegen_is_json_serializable():
    """export_for_codegen 结果可被 json 序列化（codegen 通过 subprocess 读取）。"""
    import json

    json.dumps(registry.export_for_codegen())  # 不抛异常即可
