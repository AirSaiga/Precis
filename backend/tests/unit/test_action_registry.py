"""@fileoverview 动作注册表（单一事实源）单元测试

验证注册表的派生属性自洽性，以及各消费方（validator/processor/parser/apply_actions）
的集合确实从注册表派生，而非本地硬编码。

测试目标（行为）：
- 注册表派生属性覆盖全部动作、分类互斥且并集等于全集
- spec 字段映射、读写分类、子类型白名单自洽
- 消费方的白名单与注册表一致（防漂移回归）
"""

from __future__ import annotations

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
