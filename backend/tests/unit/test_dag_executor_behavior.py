"""
@fileoverview Transform DAG 执行器行为测试
"""

from __future__ import annotations

import pandas as pd

from app.shared.services.validation.dag.builder import DAGNode, ExecutionDAG
from app.shared.services.validation.dag.executor import execute_transform_dag


class TestExecuteTransformDag:
    """execute_transform_dag 行为"""

    def test_empty_dag_returns_same_datasets(self):
        dag = ExecutionDAG(nodes={})
        datasets = {"t1": pd.DataFrame({"a": [1]})}
        result = execute_transform_dag(dag, datasets)
        assert result is datasets

    def test_dag_with_schema_node_only(self):
        node = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": node})
        datasets = {"s1": pd.DataFrame({"a": [1, 2]})}
        result = execute_transform_dag(dag, datasets)
        assert "s1" in result
        assert len(result["s1"]) == 2
