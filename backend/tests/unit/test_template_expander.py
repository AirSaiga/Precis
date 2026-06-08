"""
@fileoverview 模板展开器单元测试

测试范围:
- expand_template: 完整展开流程
- _resolve_parameters: 参数解析与校验
- _resolve_input_from_node: 上游节点引用解析
- _resolve_value: 占位符递归替换
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.project.template.expander import (
    _INPUT_ANCHOR_PLACEHOLDER,
    _resolve_input_from_node,
    _resolve_parameters,
    _resolve_value,
    expand_template,
)
from app.shared.core.project.template.types import (
    TemplateFile,
    TemplateNode,
    TemplateParameter,
)


class TestResolveParameters:
    def test_user_provided_value(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="col", type="string", label="Col", required=True)],
        )
        result = _resolve_parameters(template, {"col": "email"})
        assert result == {"col": "email"}

    def test_default_value(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="col", type="string", label="Col", required=False, default="name")],
        )
        result = _resolve_parameters(template, {})
        assert result == {"col": "name"}

    def test_missing_required_raises(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="col", type="string", label="Col", required=True)],
        )
        with pytest.raises(ValueError, match="缺少必填参数"):
            _resolve_parameters(template, {})

    def test_user_overrides_default(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="col", type="string", label="Col", required=False, default="name")],
        )
        result = _resolve_parameters(template, {"col": "email"})
        assert result == {"col": "email"}

    def test_optional_missing_no_error(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="col", type="string", label="Col", required=False)],
        )
        result = _resolve_parameters(template, {})
        assert result == {}


class TestResolveInputFromNode:
    def test_none_input(self):
        assert _resolve_input_from_node(None, {}, "ext") is None

    def test_input_anchor_placeholder(self):
        assert _resolve_input_from_node(_INPUT_ANCHOR_PLACEHOLDER, {}, "ext_node") == "ext_node"

    def test_internal_reference(self):
        id_map = {"local1": "inst__local1"}
        assert _resolve_input_from_node("local1", id_map, "ext") == "inst__local1"

    def test_external_reference_passthrough(self):
        assert _resolve_input_from_node("schema_node", {}, "ext") == "schema_node"


class TestResolveValue:
    def test_string_full_placeholder(self):
        result = _resolve_value("{{age}}", {"age": 18})
        assert result == 18

    def test_string_embedded_placeholder(self):
        result = _resolve_value("min_{{age}}_max", {"age": 18})
        assert result == "min_18_max"

    def test_string_unknown_placeholder(self):
        result = _resolve_value("{{unknown}}", {})
        assert result == "{{unknown}}"

    def test_dict_recursive(self):
        result = _resolve_value({"a": "{{x}}", "b": "{{y}}"}, {"x": 1, "y": 2})
        assert result == {"a": 1, "b": 2}

    def test_list_recursive(self):
        result = _resolve_value(["{{a}}", "fixed", "{{b}}"], {"a": 1, "b": 2})
        assert result == [1, "fixed", 2]

    def test_non_string_passthrough(self):
        assert _resolve_value(42, {}) == 42
        assert _resolve_value(3.14, {}) == 3.14
        assert _resolve_value(True, {}) is True
        assert _resolve_value(None, {}) is None


class TestExpandTemplate:
    def _make_template(self):
        return TemplateFile(
            id="age_check",
            name="Age Check",
            parameters=[
                TemplateParameter(id="source_col", type="string", label="Source", required=True),
                TemplateParameter(id="min_age", type="integer", label="Min Age", required=True),
            ],
            nodes=[
                TemplateNode(
                    id="extract",
                    kind="transform",
                    type="Substring",
                    input_from_node=_INPUT_ANCHOR_PLACEHOLDER,
                    input_column="{{source_col}}",
                    params={"start": 0, "length": 10},
                    output_columns=["extracted"],
                ),
                TemplateNode(
                    id="check",
                    kind="constraint",
                    type="Range",
                    input_from_node="extract",
                    refs={"table_id": "users", "column_id": "{{source_col}}"},
                    params={"min_value": "{{min_age}}", "max_value": 150},
                ),
            ],
        )

    def test_expand_transform_and_constraint(self):
        template = self._make_template()
        transforms, constraints, regex_nodes = expand_template(
            template,
            instance_id="inst1",
            params={"source_col": "id_card", "min_age": 18},
            input_from_node="schema_users",
        )
        assert len(transforms) == 1
        assert len(constraints) == 1
        assert len(regex_nodes) == 0

        tf = transforms[0]
        assert tf.id == "inst1__extract"
        assert tf.input_from_node == "schema_users"
        assert tf.input_column == "id_card"

        cf = constraints[0]
        assert cf.id == "inst1__check"
        assert cf.input_from_node == "inst1__extract"
        assert cf.refs["column_id"] == "id_card"
        assert cf.params["min_value"] == 18

    def test_disabled_node_skipped(self):
        template = TemplateFile(
            id="t1",
            name="T",
            nodes=[
                TemplateNode(id="n1", kind="transform", type="Substring", enabled=False),
            ],
        )
        transforms, constraints, regex_nodes = expand_template(template, "i1", {}, "input")
        assert len(transforms) == 0

    def test_regex_node(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="pat", type="string", label="Pattern", required=True)],
            nodes=[
                TemplateNode(
                    id="r1",
                    kind="regex",
                    type="Regex",
                    params={"pattern": "{{pat}}"},
                    input_column="email",
                    output_columns=["match"],
                ),
            ],
        )
        _, _, regex_nodes = expand_template(template, "i1", {"pat": r"^\w+$"}, "input")
        assert len(regex_nodes) == 1
        assert regex_nodes[0].pattern == r"^\w+$"
        assert regex_nodes[0].id == "i1__r1"

    def test_node_exception_continues(self):
        template = TemplateFile(
            id="t1",
            name="T",
            parameters=[TemplateParameter(id="x", type="string", label="X", required=True)],
            nodes=[
                TemplateNode(id="bad", kind="transform", type="Unknown", input_column="{{missing}}"),
                TemplateNode(id="good", kind="constraint", type="NotNull"),
            ],
        )
        # missing param should not raise, just warn and continue
        transforms, constraints, _ = expand_template(template, "i1", {"x": "val"}, "input")
        # bad node may or may not produce output depending on error handling
        # but good node should still be processed
        assert len(constraints) == 1

    def test_empty_template(self):
        template = TemplateFile(id="t1", name="T", parameters=[], nodes=[])
        transforms, constraints, regex_nodes = expand_template(template, "i1", {}, "input")
        assert transforms == []
        assert constraints == []
        assert regex_nodes == []
