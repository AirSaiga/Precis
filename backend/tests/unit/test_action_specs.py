"""@fileoverview AI 动作 Spec Pydantic 模型单元测试

验证 specs.py 的结构校验逻辑：
- 枚举白名单（约束类型、转换类型、设置分类、资源类型）交由上下文 validator，Pydantic 只做结构解析
- parse_action_spec 统一入口的解析与错误转换

测试原则（遵循 AGENTS.md）：工厂函数 + 验证结果不验证过程。
"""

from __future__ import annotations

import pytest

from app.shared.services.llm.actions.specs import (
    CanvasSpec,
    ConstraintSpec,
    SettingsSpec,
    SpecParseError,
    TransformSpec,
    parse_action_spec,
)

# =============================================================================
# Spec 模型校验范围（Pydantic 只做结构解析，参数关系与枚举交给上下文 validator）
# =============================================================================


class TestSpecWhitelists:
    """Pydantic 层只做参数关系校验；枚举白名单交给上下文 validator。

    故此处只验证 Pydantic 补充的结构规则，不重复测枚举白名单（那些在 test_llm_action_validator）。
    """

    def test_constraint_spec_accepts_alias(self):
        """别名（大写下划线）合法。"""
        s = ConstraintSpec(type="NOT_NULL", tableName="users")
        assert s.type == "NOT_NULL"

    def test_constraint_spec_does_not_check_params(self):
        """ConstraintSpec 不在 Pydantic 层校验参数（交给 _constraint_validator）。

        Range min>max 等参数关系校验由 _constraint_validator（missing_required_param 等
        错误类型）与 constraint_builder（Scripted 空表达式）承担，不在 parse_action_spec 触发。
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
