"""
@fileoverview Transform DAG 执行器行为测试
"""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd

from app.shared.core.project.transform.types import TransformFile
from app.shared.services.validation.dag.builder import DAGNode, ExecutionDAG
from app.shared.services.validation.dag.executor import execute_transform_dag


class TestExecuteTransformDag:
    """execute_transform_dag 行为"""

    def test_empty_dag_returns_same_datasets(self):
        dag = ExecutionDAG(nodes={})
        datasets = {"t1": pd.DataFrame({"a": [1]})}
        result = execute_transform_dag(dag, datasets)
        # 空 DAG 仍返回 (datasets, []):datasets 引用不变
        out_datasets, out_errors = result
        assert out_datasets is datasets
        assert out_errors == []

    def test_dag_with_schema_node_only(self):
        node = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": node})
        datasets = {"s1": pd.DataFrame({"a": [1, 2]})}
        result = execute_transform_dag(dag, datasets)
        out_datasets, out_errors = result
        assert "s1" in out_datasets
        assert len(out_datasets["s1"]) == 2
        assert out_errors == []

    def test_transform_failure_surfaces_as_error(self):
        """回归 #6: transform 节点执行抛异常时,原实现仅 logger.exception 后把未转换的
        输入复制为输出继续跑,且 execute_transform_dag 无错误返回通道,engine 无从感知 →
        下游约束在未转换数据上"假通过",报告显示一切正常。

        要求:execute_transform_dag 返回 (datasets, errors),失败的 transform 应在 errors
        中体现(含节点 ID 与失败原因),让 engine 能上报到校验报告。
        """
        # 构造一个 transform 节点,其 runner.execute 抛异常
        tfile = TransformFile(
            id="t1",
            type="StringSplit",
            input_from_node="s1",
            input_column="a",
            params={"delimiter": ","},
            output_columns=["out"],
        )
        tnode = DAGNode(id="t1", node_type="transform", data=tfile)
        snode = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": snode, "t1": tnode})
        datasets = {"s1": pd.DataFrame({"a": ["x,y"]})}

        # 让 create_runner 返回一个 execute 会抛异常的 runner
        class _BoomRunner:
            def execute(self, *args, **kwargs):
                raise RuntimeError("transform 配置错误: 模拟失败")

        with patch("app.shared.services.validation.dag.executor.create_runner", return_value=_BoomRunner()):
            result = execute_transform_dag(dag, datasets)

        # 必须返回 (datasets, errors) 二元组
        assert isinstance(result, tuple) and len(result) == 2
        out_datasets, out_errors = result
        assert len(out_errors) >= 1, f"transform 失败应上报错误,实际: {out_errors}"
        err = out_errors[0]
        # 错误应包含节点标识与失败原因,便于用户定位
        assert "t1" in str(err) or "t1" in str(err.get("message", "")), f"错误应含节点 ID,实际: {err}"
        assert "模拟失败" in str(err.get("message", "")) or err.get("error_type") == "TransformExecutionError"

    def test_regex_failure_surfaces_as_error(self):
        """回归 #6: regex 节点执行失败也应上报。"""
        from app.shared.core.project.regex.types import RegexNodeFile

        rfile = RegexNodeFile(
            id="r1",
            name="r1",
            pattern="(\\d+)",
            match_mode="extract",
            input_column="a",
            input_from_node="s1",
            output_columns=["num"],
        )
        rnode = DAGNode(id="r1", node_type="regex", data=rfile)
        snode = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": snode, "r1": rnode})
        datasets = {"s1": pd.DataFrame({"a": ["123"]})}

        # 让 re.compile 抛异常(模拟 invalid regex flags 等)
        with patch("app.shared.services.validation.dag.executor.re.compile", side_effect=RuntimeError("regex boom")):
            result = execute_transform_dag(dag, datasets)

        out_datasets, out_errors = result
        assert len(out_errors) >= 1, f"regex 失败应上报错误,实际: {out_errors}"
        assert "r1" in str(out_errors[0]) or "r1" in str(out_errors[0].get("message", ""))


class TestSortRowsDagMerge:
    """回归 #7: SortRows transform 在 DAG 合并逻辑中两种配置都错。

    SortRows 行数不变 → 走"按列贴回"分支,循环 tfile.output_columns;而 sort_rows 明确
    output_columns 被忽略。后果:
    - output_columns 为空(正确用法)→ 循环不执行 → 排序结果永远写不回,校验的是未排序数据;
    - output_columns 填了(误填)→ output_df[col].values 按位置贴回未排序的行 → 行数据错配。
    要求:SortRows(行重排、output_columns 为空)应整体替换 schema 节点输出,而非按列贴回。
    """

    def test_sortrows_result_actually_applied(self):
        """SortRows 排序后,下游 dataset 应是排好序的(而非原序)。"""
        # 乱序数据,按 val 升序排
        tfile = TransformFile(
            id="sort1",
            type="SortRows",
            input_from_node="s1",
            input_column="val",  # SortRows 忽略 input_column,但协议要求传
            params={"sort_by": [{"column": "val", "order": "asc"}]},
            output_columns=[],  # SortRows 不产生新列(正确用法)
        )
        tnode = DAGNode(id="sort1", node_type="transform", data=tfile)
        snode = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": snode, "sort1": tnode})
        datasets = {"s1": pd.DataFrame({"id": [1, 2, 3], "val": [30, 10, 20]})}

        out_datasets, out_errors = execute_transform_dag(dag, datasets)
        assert out_errors == [], f"SortRows 不应报错,实际: {out_errors}"

        # 关键:s1 的输出应是按 val 升序排好的 [10,20,30],对应 id [2,3,1]
        result_df = out_datasets["s1"]
        assert list(result_df["val"]) == [10, 20, 30], (
            f"SortRows 排序结果应写回(整体替换),实际 val 仍为原序: {list(result_df['val'])}"
        )
        assert list(result_df["id"]) == [2, 3, 1], (
            f"行应整体重排(id 跟着 val 走),实际 id: {list(result_df['id'])} —— 若按位置贴回会错配"
        )

    def test_sortrows_with_output_columns_does_not_misalign_rows(self):
        """回归 #7: 即使用户误填了 output_columns,也不应导致行数据错配。

        原实现按位置贴回会把排序后的列值贴到未排序行上,使 id 与 val 错配。
        """
        tfile = TransformFile(
            id="sort1",
            type="SortRows",
            input_from_node="s1",
            input_column="val",
            params={"sort_by": [{"column": "val", "order": "asc"}]},
            output_columns=["val"],  # 误填(SortRows 应忽略),但不应导致错配
        )
        tnode = DAGNode(id="sort1", node_type="transform", data=tfile)
        snode = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": snode, "sort1": tnode})
        datasets = {"s1": pd.DataFrame({"id": [1, 2, 3], "val": [30, 10, 20]})}

        out_datasets, out_errors = execute_transform_dag(dag, datasets)
        assert out_errors == [], f"SortRows 不应报错,实际: {out_errors}"

        result_df = out_datasets["s1"]
        # id 与 val 应保持正确的行对应关系(整体重排),而非按位置错配
        assert list(result_df["val"]) == [10, 20, 30]
        assert list(result_df["id"]) == [2, 3, 1], (
            f"误填 output_columns 时行也不应错配,实际 id: {list(result_df['id'])}"
        )
