"""@fileoverview AI 动作 Spec Pydantic 模型单元测试

验证 specs.py 的结构校验逻辑：
- Range min<=max 关系（原系统完全缺失的新校验）
- 各约束类型必填参数
- 枚举白名单（约束类型、转换类型、设置分类、资源类型）
- parse_action_spec 统一入口的解析与错误转换

测试原则（遵循 AGENTS.md）：工厂函数 + 验证结果不验证过程。
"""

from __future__ import annotations

import pytest

from app.shared.services.llm.actions.specs import (
    AllowedValuesParams,
    CanvasSpec,
    ConstraintSpec,
    ForeignKeyParams,
    RangeParams,
    ScriptedParams,
    SettingsSpec,
    SpecParseError,
    TransformSpec,
    parse_action_spec,
    validate_constraint_params_model,
)

# =============================================================================
# Range 参数校验（原系统缺失 min<=max 检查，本模型补上）
# =============================================================================


class TestRangeParams:
    def test_normal_range_accepted(self):
        """正常的 min/max 范围通过。"""
        r = RangeParams(min=0, max=120)
        assert r.min == 0 and r.max == 120

    def test_only_min_accepted(self):
        """只提供 min 也合法（与现有 validator 行为一致）。"""
        r = RangeParams(min=0)
        assert r.min == 0 and r.max is None

    def test_only_max_accepted(self):
        """只提供 max 也合法。"""
        r = RangeParams(max=120)
        assert r.max == 120 and r.min is None

    def test_min_greater_than_max_rejected(self):
        """min > max 必须被拒（新校验，原系统完全缺失）。"""
        with pytest.raises(Exception, match="不能大于"):
            RangeParams(min=100, max=50)

    def test_both_empty_rejected(self):
        """min 和 max 都缺被拒。"""
        with pytest.raises(Exception, match="至少提供"):
            RangeParams()

    def test_negative_range_accepted(self):
        """负数范围合法。"""
        r = RangeParams(min=-100, max=-10)
        assert r.min == -100


# =============================================================================
# 其他约束参数模型
# =============================================================================


class TestOtherConstraintParams:
    def test_allowed_values_empty_rejected(self):
        """AllowedValues 必须有非空列表。"""
        with pytest.raises(Exception):
            AllowedValuesParams(allowedValues=[])

    def test_foreign_key_requires_both(self):
        """ForeignKey 需 toTableId 和 toColumnId。"""
        with pytest.raises(Exception):
            ForeignKeyParams(toTableId="users")
        fk = ForeignKeyParams(toTableId="users", toColumnId="id")
        assert fk.toTableId == "users"

    def test_scripted_requires_expression_or_pattern(self):
        """Scripted 需 expression 或 pattern 二选一。"""
        with pytest.raises(Exception, match="expression 或 pattern"):
            ScriptedParams()
        s = ScriptedParams(pattern=r"^\w+@\w+$")
        assert s.pattern is not None


# =============================================================================
# validate_constraint_params_model（供 validator 调用的适配函数）
# =============================================================================


class TestValidateConstraintParamsModel:
    def test_range_valid_returns_empty(self):
        assert validate_constraint_params_model("Range", {"min": 0, "max": 120}) == []

    def test_range_min_gt_max_returns_error(self):
        """min>max 返回错误消息（新校验）。"""
        errors = validate_constraint_params_model("Range", {"min": 100, "max": 50})
        assert len(errors) > 0
        assert any("不能大于" in e for e in errors)

    def test_unknown_type_returns_empty(self):
        """未知类型不报错（由上层白名单拦截）。"""
        assert validate_constraint_params_model("Unknown", {}) == []


# =============================================================================
# Spec 模型校验范围（Pydantic 只做参数关系，枚举交给上下文 validator）
# =============================================================================


class TestSpecWhitelists:
    """Pydantic 层只做参数关系校验（Range min<=max 等）；枚举白名单交给上下文 validator。

    故此处只验证 Pydantic 补充的结构规则，不重复测枚举白名单（那些在 test_llm_action_validator）。
    """

    def test_constraint_spec_accepts_alias(self):
        """别名（大写下划线）合法。"""
        s = ConstraintSpec(type="NOT_NULL", tableName="users")
        assert s.type == "NOT_NULL"

    def test_constraint_spec_does_not_check_params(self):
        """ConstraintSpec 不在 Pydantic 层校验参数（交给 _constraint_validator）。

        Range min>max 等参数关系校验由 validate_constraint_params_model 函数承担，
        不在 parse_action_spec 自动触发，避免与 validator 的参数检查冲突。
        """
        # min>max 不被 ConstraintSpec 拦截（合法解析）
        s = ConstraintSpec(type="Range", tableName="users", params={"min": 100, "max": 50})
        assert s.params == {"min": 100, "max": 50}

    def test_transform_spec_accepts_any_type(self):
        """转换类型白名单不在 Pydantic 层（交给 _transform_validator）。"""
        t = TransformSpec(type="Anything")
        assert t.type == "Anything"

    def test_settings_spec_accepts_any_category(self):
        """设置分类白名单不在 Pydantic 层（交给 _settings_validator）。"""
        s = SettingsSpec(category="anything", settings={})
        assert s.category == "anything"

    def test_canvas_spec_accepts_any_kind(self):
        """资源类型白名单不在 Pydantic 层（交给 _canvas_validator）。"""
        c = CanvasSpec(resourceKind="anything", resourceId="x")
        assert c.resourceKind == "anything"


# =============================================================================
# parse_action_spec 统一入口
# =============================================================================


class TestParseActionSpec:
    def test_parse_schema_ok(self):
        model = parse_action_spec({"actionType": "ADD_SCHEMA", "schemaSpec": {"name": "users"}})
        assert isinstance(model, object)

    def test_parse_constraint_ok(self):
        model = parse_action_spec(
            {
                "actionType": "ADD_CONSTRAINT_NODE",
                "constraintSpec": {"type": "NotNull", "tableName": "users"},
            }
        )
        assert isinstance(model, ConstraintSpec)

    def test_parse_validate_project_allows_empty_spec(self):
        """VALIDATE_PROJECT 可空壳（校验全部表），spec 缺失不报错。"""
        model = parse_action_spec({"actionType": "VALIDATE_PROJECT"})
        assert model is not None

    def test_parse_missing_spec_raises(self):
        """写动作缺 spec 字段报错。"""
        with pytest.raises(SpecParseError, match="缺少"):
            parse_action_spec({"actionType": "ADD_SCHEMA"})

    def test_parse_bad_spec_field_raises_with_message_attr(self):
        """spec 字段缺失时 SpecParseError 有 message 和 errors 属性。"""
        with pytest.raises(SpecParseError) as exc_info:
            parse_action_spec({"actionType": "ADD_SCHEMA"})  # 缺 schemaSpec
        assert "缺少" in exc_info.value.message
        assert len(exc_info.value.errors) > 0

    def test_range_min_gt_max_caught_by_params_function(self):
        """Range min>max 由 validate_constraint_params_model 捕获（非 parse_action_spec）。

        参数关系校验走 validator 路径（有 missing_required_param 错误类型），
        不在 parse_action_spec 自动触发，避免与 validator 冲突。
        """
        errors = validate_constraint_params_model("Range", {"min": 100, "max": 50})
        assert len(errors) > 0
        assert any("不能大于" in e for e in errors)
