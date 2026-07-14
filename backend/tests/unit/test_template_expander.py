"""
@fileoverview 模板展开器单元测试

测试范围:
- expand_template: 完整展开流程
- _resolve_input_from_node: 上游节点引用解析
"""

from app.shared.core.project.template.expander import (
    _resolve_input_from_node,
    expand_template,
)
from app.shared.core.project.template.types import (
    TemplateFile,
    TemplateNode,
)


class TestResolveInputFromNode:
    def test_none_input(self):
        assert _resolve_input_from_node(None, {}) is None

    def test_internal_reference(self):
        id_map = {"local1": "inst__local1"}
        assert _resolve_input_from_node("local1", id_map) == "inst__local1"

    def test_external_reference_passthrough(self):
        assert _resolve_input_from_node("schema_node", {}) == "schema_node"


class TestExpandTemplate:
    def _make_template(self):
        return TemplateFile(
            id="age_check",
            name="Age Check",
            nodes=[
                TemplateNode(
                    id="md1",
                    kind="manualData",
                    type="ManualData",
                    column_name="age",
                    column_data_type="integer",
                    rows=[["18"], ["25"], ["65"]],
                ),
                TemplateNode(
                    id="check",
                    kind="constraint",
                    type="Range",
                    input_from_node="md1",
                    refs={"table_id": "users", "column_id": "age"},
                    params={"min_value": 18, "max_value": 150},
                ),
            ],
        )

    def test_expand_manual_data_and_constraint(self):
        template = self._make_template()
        transforms, constraints, regex_nodes, manual_data = expand_template(
            template,
            instance_id="inst1",
        )
        assert len(manual_data) == 1
        assert len(constraints) == 1
        assert len(transforms) == 0
        assert len(regex_nodes) == 0

        md = manual_data[0]
        assert md.id == "inst1__md1"
        assert md.column_name == "age"
        assert md.column_data_type == "integer"
        assert md.rows == [["18"], ["25"], ["65"]]

        cf = constraints[0]
        assert cf.id == "inst1__check"
        assert cf.input_from_node == "inst1__md1"
        assert cf.refs["column_id"] == "age"
        assert cf.params["min_value"] == 18

    def test_disabled_node_skipped(self):
        template = TemplateFile(
            id="t1",
            name="T",
            nodes=[
                TemplateNode(id="n1", kind="transform", type="Substring", enabled=False),
            ],
        )
        transforms, _, _, _ = expand_template(template, "i1")
        assert len(transforms) == 0

    def test_regex_node(self):
        template = TemplateFile(
            id="t1",
            name="T",
            nodes=[
                TemplateNode(
                    id="r1",
                    kind="regex",
                    type="Regex",
                    params={"pattern": r"^\w+$"},
                    input_column="email",
                    output_columns=["match"],
                ),
            ],
        )
        _, _, regex_nodes, _ = expand_template(template, "i1")
        assert len(regex_nodes) == 1
        assert regex_nodes[0].pattern == r"^\w+$"
        assert regex_nodes[0].id == "i1__r1"

    def test_node_exception_continues(self):
        template = TemplateFile(
            id="t1",
            name="T",
            nodes=[
                TemplateNode(id="bad", kind="transform", type="Unknown", input_column="test"),
                TemplateNode(id="good", kind="constraint", type="NotNull"),
            ],
        )
        _, constraints, _, _ = expand_template(template, "i1")
        assert len(constraints) == 1

    def test_empty_template(self):
        template = TemplateFile(id="t1", name="T", nodes=[])
        transforms, constraints, regex_nodes, _ = expand_template(template, "i1")
        assert transforms == []
        assert constraints == []
        assert regex_nodes == []

    def test_constraint_input_column_propagated(self):
        """约束的 input_column 透传到 ConstraintFile，用于多列 transform 下游定位列"""
        template = TemplateFile(
            id="t_col",
            name="T",
            nodes=[
                TemplateNode(
                    id="t1",
                    kind="transform",
                    type="StringSplit",
                    input_from_node=None,
                    input_column="full_name",
                    output_columns=["first", "last"],
                ),
                TemplateNode(
                    id="c1",
                    kind="constraint",
                    type="NotNull",
                    input_from_node="t1",
                    input_column="last",
                ),
            ],
        )
        _, constraints, _, _ = expand_template(template, "inst1")
        assert len(constraints) == 1
        # input_column 必须透传，前端据此把约束路由到对应列的 transformOutput 节点
        assert constraints[0].input_column == "last"
        assert constraints[0].input_from_node == "inst1__t1"

    def test_constraint_input_column_none_when_absent(self):
        """未声明 input_column 时默认 None，不影响既有模板"""
        template = TemplateFile(
            id="t_nocol",
            name="T",
            nodes=[
                TemplateNode(
                    id="md1",
                    kind="manualData",
                    type="ManualData",
                    column_name="age",
                    rows=[["18"]],
                ),
                TemplateNode(
                    id="c1",
                    kind="constraint",
                    type="Range",
                    input_from_node="md1",
                ),
            ],
        )
        _, constraints, _, _ = expand_template(template, "i1")
        assert len(constraints) == 1
        assert constraints[0].input_column is None

    def test_manual_data_disabled_skipped(self):
        """disabled 的 manualData 节点不展开"""
        template = TemplateFile(
            id="t_md",
            name="T",
            nodes=[
                TemplateNode(
                    id="md1",
                    kind="manualData",
                    type="ManualData",
                    enabled=False,
                    column_name="age",
                    rows=[["18"]],
                ),
            ],
        )
        _, _, _, manual_data = expand_template(template, "i1")
        assert len(manual_data) == 0

    def test_multiple_manual_data_entries(self):
        """多 manualData 入口"""
        template = TemplateFile(
            id="t_multi",
            name="T",
            nodes=[
                TemplateNode(
                    id="md1",
                    kind="manualData",
                    type="ManualData",
                    column_name="age",
                    rows=[["18"]],
                ),
                TemplateNode(
                    id="md2",
                    kind="manualData",
                    type="ManualData",
                    column_name="name",
                    rows=[["alice"]],
                ),
                TemplateNode(
                    id="c1",
                    kind="constraint",
                    type="NotNull",
                    input_from_node="md1",
                ),
                TemplateNode(
                    id="c2",
                    kind="constraint",
                    type="NotNull",
                    input_from_node="md2",
                ),
            ],
        )
        _, constraints, _, manual_data = expand_template(template, "inst1")
        assert len(manual_data) == 2
        assert len(constraints) == 2
        assert manual_data[0].id == "inst1__md1"
        assert manual_data[1].id == "inst1__md2"
        assert constraints[0].input_from_node == "inst1__md1"
        assert constraints[1].input_from_node == "inst1__md2"
