"""
@fileoverview DAG 构建器和拓扑排序测试（T48 覆盖补充）

覆盖目标:
- dag/builder.py: build_execution_dag, DAGNode, ExecutionDAG
- dag/sorter.py: topological_sort
"""

import pytest

from app.shared.core.project.regex.types import RegexNodeFile, RegexSourceRef
from app.shared.core.project.transform.types import TransformFile
from app.shared.services.validation.dag.builder import DAGNode, ExecutionDAG, build_execution_dag
from app.shared.services.validation.dag.sorter import topological_sort

# ============================================================================
# DAGNode 测试
# ============================================================================


class TestDAGNode:
    def test_creation(self):
        node = DAGNode(id="t1", node_type="transform")
        assert node.id == "t1"
        assert node.node_type == "transform"
        assert node.data is None
        assert node.incoming == []
        assert node.outgoing == []

    def test_creation_with_data(self):
        tfile = TransformFile(id="t1", type="MathExpr", params={"expr": "a+b"})
        node = DAGNode(id="t1", node_type="transform", data=tfile)
        assert node.data is tfile
        assert node.data.type == "MathExpr"


class TestExecutionDAG:
    def test_empty_dag(self):
        dag = ExecutionDAG()
        assert dag.nodes == {}

    def test_dag_with_nodes(self):
        dag = ExecutionDAG()
        dag.nodes["s1"] = DAGNode(id="s1", node_type="schema")
        dag.nodes["t1"] = DAGNode(id="t1", node_type="transform")
        assert len(dag.nodes) == 2


# ============================================================================
# build_execution_dag 测试
# ============================================================================


class TestBuildExecutionDAG:
    def test_empty_inputs(self):
        dag = build_execution_dag({}, set())
        assert dag.nodes == {}

    def test_schema_nodes_only(self):
        dag = build_execution_dag({}, {"users", "orders"})
        assert len(dag.nodes) == 2
        assert dag.nodes["users"].node_type == "schema"
        assert dag.nodes["orders"].node_type == "schema"

    def test_transform_nodes_only(self):
        transforms = {
            "t1": TransformFile(id="t1", type="MathExpr", enabled=True),
            "t2": TransformFile(id="t2", type="Strip", enabled=True),
        }
        dag = build_execution_dag(transforms, set())
        assert len(dag.nodes) == 2
        assert dag.nodes["t1"].node_type == "transform"
        assert dag.nodes["t2"].node_type == "transform"

    def test_disabled_transform_excluded(self):
        transforms = {
            "t1": TransformFile(id="t1", type="MathExpr", enabled=True),
            "t2": TransformFile(id="t2", type="Strip", enabled=False),
        }
        dag = build_execution_dag(transforms, set())
        assert "t1" in dag.nodes
        assert "t2" not in dag.nodes

    def test_edge_from_input_from_node(self):
        transforms = {
            "t1": TransformFile(id="t1", type="MathExpr", enabled=True, input_from_node="s1"),
        }
        dag = build_execution_dag(transforms, {"s1"})
        assert "s1" in dag.nodes["t1"].incoming
        assert "t1" in dag.nodes["s1"].outgoing

    def test_dangling_dependency_ignored(self):
        """上游节点未定义时应静默忽略。"""
        transforms = {
            "t1": TransformFile(id="t1", type="MathExpr", enabled=True, input_from_node="nonexistent"),
        }
        dag = build_execution_dag(transforms, set())
        assert "t1" in dag.nodes
        assert dag.nodes["t1"].incoming == []

    def test_regex_extract_nodes_included(self):
        """extract 模式的 regex 节点应加入 DAG。"""
        regex_files = {
            "r1": RegexNodeFile(
                id="r1",
                name="phone_extract",
                pattern=r"(\d{3})(\d{4})",
                match_mode="extract",
                enabled=True,
                input_from_node="s1",
                output_columns=["part1", "part2"],
            ),
        }
        dag = build_execution_dag({}, {"s1"}, regex_files=regex_files)
        assert "r1" in dag.nodes
        assert dag.nodes["r1"].node_type == "regex"
        assert "s1" in dag.nodes["r1"].incoming

    def test_regex_full_mode_excluded(self):
        """full 模式的 regex 节点不应加入 DAG。"""
        regex_files = {
            "r1": RegexNodeFile(
                id="r1",
                name="phone_check",
                pattern=r"^\d{11}$",
                match_mode="full",
                enabled=True,
            ),
        }
        dag = build_execution_dag({}, set(), regex_files=regex_files)
        assert "r1" not in dag.nodes

    def test_regex_disabled_excluded(self):
        """禁用的 regex 节点不应加入 DAG。"""
        regex_files = {
            "r1": RegexNodeFile(
                id="r1",
                name="test",
                pattern=r"\d+",
                match_mode="extract",
                enabled=False,
            ),
        }
        dag = build_execution_dag({}, set(), regex_files=regex_files)
        assert "r1" not in dag.nodes

    def test_regex_source_ref_fallback(self):
        """regex 节点无 input_from_node 时应使用 source_ref.table_id。"""
        regex_files = {
            "r1": RegexNodeFile(
                id="r1",
                name="test",
                pattern=r"\d+",
                match_mode="extract",
                enabled=True,
                source_ref=RegexSourceRef(table_id="users", column_id="phone"),
            ),
        }
        dag = build_execution_dag({}, {"users"}, regex_files=regex_files)
        assert "users" in dag.nodes["r1"].incoming

    def test_complex_dag(self):
        """复杂 DAG：schema → transform → transform + regex。"""
        transforms = {
            "t1": TransformFile(id="t1", type="MathExpr", enabled=True, input_from_node="s1"),
            "t2": TransformFile(id="t2", type="Strip", enabled=True, input_from_node="t1"),
        }
        regex_files = {
            "r1": RegexNodeFile(
                id="r1",
                name="extract",
                pattern=r"(\d+)",
                match_mode="extract",
                enabled=True,
                input_from_node="s1",
                output_columns=["digits"],
            ),
        }
        dag = build_execution_dag(transforms, {"s1"}, regex_files=regex_files)
        assert len(dag.nodes) == 4  # s1, t1, t2, r1
        assert "t1" in dag.nodes["s1"].outgoing
        assert "r1" in dag.nodes["s1"].outgoing
        assert "t2" in dag.nodes["t1"].outgoing


# ============================================================================
# topological_sort 测试
# ============================================================================


class TestTopologicalSort:
    def test_empty_dag(self):
        dag = ExecutionDAG()
        result = topological_sort(dag)
        assert result == []

    def test_single_node(self):
        dag = ExecutionDAG()
        dag.nodes["s1"] = DAGNode(id="s1", node_type="schema")
        result = topological_sort(dag)
        assert result == ["s1"]

    def test_linear_chain(self):
        """线性链：s1 → t1 → t2"""
        dag = ExecutionDAG()
        dag.nodes["s1"] = DAGNode(id="s1", node_type="schema", outgoing=["t1"])
        dag.nodes["t1"] = DAGNode(id="t1", node_type="transform", incoming=["s1"], outgoing=["t2"])
        dag.nodes["t2"] = DAGNode(id="t2", node_type="transform", incoming=["t1"])

        result = topological_sort(dag)
        assert result.index("s1") < result.index("t1")
        assert result.index("t1") < result.index("t2")

    def test_diamond_dag(self):
        """菱形 DAG：s1 → t1, s1 → t2, t1 → t3, t2 → t3"""
        dag = ExecutionDAG()
        dag.nodes["s1"] = DAGNode(id="s1", node_type="schema", outgoing=["t1", "t2"])
        dag.nodes["t1"] = DAGNode(id="t1", node_type="transform", incoming=["s1"], outgoing=["t3"])
        dag.nodes["t2"] = DAGNode(id="t2", node_type="transform", incoming=["s1"], outgoing=["t3"])
        dag.nodes["t3"] = DAGNode(id="t3", node_type="transform", incoming=["t1", "t2"])

        result = topological_sort(dag)
        assert result.index("s1") < result.index("t1")
        assert result.index("s1") < result.index("t2")
        assert result.index("t1") < result.index("t3")
        assert result.index("t2") < result.index("t3")

    def test_cycle_raises_error(self):
        """循环依赖应抛出 ValueError。"""
        dag = ExecutionDAG()
        dag.nodes["t1"] = DAGNode(id="t1", node_type="transform", incoming=["t2"], outgoing=["t2"])
        dag.nodes["t2"] = DAGNode(id="t2", node_type="transform", incoming=["t1"], outgoing=["t1"])

        with pytest.raises(ValueError, match="循环依赖"):
            topological_sort(dag)

    def test_multiple_roots(self):
        """多个根节点应都能正确排序。"""
        dag = ExecutionDAG()
        dag.nodes["s1"] = DAGNode(id="s1", node_type="schema", outgoing=["t1"])
        dag.nodes["s2"] = DAGNode(id="s2", node_type="schema", outgoing=["t2"])
        dag.nodes["t1"] = DAGNode(id="t1", node_type="transform", incoming=["s1"])
        dag.nodes["t2"] = DAGNode(id="t2", node_type="transform", incoming=["s2"])

        result = topological_sort(dag)
        assert len(result) == 4
        assert result.index("s1") < result.index("t1")
        assert result.index("s2") < result.index("t2")


# ============================================================================
# build_transform_dag 兼容别名测试
# ============================================================================


class TestBuildTransformDagAlias:
    def test_alias_works(self):
        from app.shared.services.validation.dag.builder import build_transform_dag

        assert build_transform_dag is build_execution_dag
