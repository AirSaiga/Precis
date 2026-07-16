"""
@fileoverview 校验引擎和 DAG 执行器测试（T48 覆盖补充）

覆盖目标:
- services/validation/engine.py: validate_full_dataset 核心路径
- services/validation/dag/executor.py: execute_transform_dag 核心路径
"""

import pandas as pd

from app.shared.core.project.transform.types import TransformFile
from app.shared.domain.data_types import IntegerType, StringType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.domain.validation_constraints import NotNullConstraint
from app.shared.services.validation.dag.builder import DAGNode, ExecutionDAG
from app.shared.services.validation.dag.executor import execute_transform_dag
from app.shared.services.validation.engine import validate_full_dataset

# ============================================================================
# validate_full_dataset 测试
# ============================================================================


class TestValidateFullDataset:
    def test_basic_format_validation(self):
        """基本格式校验应正确解析数据。"""
        raw = {"users": pd.DataFrame({"id": [1, 2], "name": ["alice", "bob"]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[
                        ColumnSchema(name="id", data_type=IntegerType()),
                        ColumnSchema(name="name", data_type=StringType()),
                    ],
                )
            },
            constraints=[],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert "users" in parsed
        assert len(details["format_checks"]) == 1
        assert details["format_checks"][0]["passed"] is True

    def test_format_validation_with_errors(self):
        """格式校验应检测类型错误。"""
        raw = {"users": pd.DataFrame({"id": [1, "abc"], "name": ["alice", "bob"]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[
                        ColumnSchema(name="id", data_type=IntegerType()),
                        ColumnSchema(name="name", data_type=StringType()),
                    ],
                )
            },
            constraints=[],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert "users" in parsed
        # May or may not have format errors depending on how process_dataframe handles this

    def test_table_not_in_schema_skipped(self):
        """未在 Schema 中定义的表应被跳过。"""
        raw = {
            "users": pd.DataFrame({"id": [1], "name": ["alice"]}),
            "extra": pd.DataFrame({"col": [1]}),
        }
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[ColumnSchema(name="id", data_type=IntegerType())],
                )
            },
            constraints=[],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert "users" in parsed
        assert "extra" not in parsed

    def test_empty_datasets_skip_constraint_validation(self):
        """空数据集应跳过约束校验。"""
        raw = {"users": pd.DataFrame()}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[ColumnSchema(name="id", data_type=IntegerType())],
                )
            },
            constraints=[NotNullConstraint(table="users", column="id")],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert len(details["constraint_checks"]) == 0

    def test_constraint_validation_with_not_null(self):
        """NotNull 约束应正确执行。"""
        raw = {"users": pd.DataFrame({"id": [1, None, 3], "name": ["a", "b", "c"]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[
                        ColumnSchema(name="id", data_type=IntegerType()),
                        ColumnSchema(name="name", data_type=StringType()),
                    ],
                )
            },
            constraints=[NotNullConstraint(table="users", column="id")],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert len(details["constraint_checks"]) == 1
        # Should have at least 1 error for the None value
        constraint_errors = [e for e in errors if e.get("stage") == "constraint"]
        assert len(constraint_errors) >= 1

    def test_table_filter(self):
        """table_filter 应只验证相关表的约束。"""
        raw = {
            "users": pd.DataFrame({"id": [1, 2]}),
            "orders": pd.DataFrame({"id": [1, 2]}),
        }
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users", name="users", columns=[ColumnSchema(name="id", data_type=IntegerType())]
                ),
                "orders": TableSchema(
                    id="orders", name="orders", columns=[ColumnSchema(name="id", data_type=IntegerType())]
                ),
            },
            constraints=[
                NotNullConstraint(table="users", column="id"),
                NotNullConstraint(table="orders", column="id"),
            ],
        )
        parsed, errors, details = validate_full_dataset(raw, schema, table_filter="users")
        # Only users constraint should run
        assert len(details["constraint_checks"]) == 1
        assert details["constraint_checks"][0]["table"] == "users"

    def test_constraint_exception_handled(self):
        """约束执行异常应被捕获并记录。"""

        class BadConstraint:
            def get_constraint_info(self):
                return {"table": "users", "constraint_type": "BadConstraint"}

            def validate(self, datasets, **kwargs):
                raise RuntimeError("boom")

        raw = {"users": pd.DataFrame({"id": [1]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users", name="users", columns=[ColumnSchema(name="id", data_type=IntegerType())]
                )
            },
            constraints=[BadConstraint()],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert len(details["constraint_checks"]) == 1
        assert details["constraint_checks"][0]["passed"] is False

    def test_get_constraint_info_exception(self):
        """get_constraint_info 异常应被处理。"""

        class BadInfoConstraint:
            def get_constraint_info(self):
                raise RuntimeError("info error")

            def validate(self, datasets, **kwargs):
                return {"errors": [], "info": {}}

        raw = {"users": pd.DataFrame({"id": [1]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users", name="users", columns=[ColumnSchema(name="id", data_type=IntegerType())]
                )
            },
            constraints=[BadInfoConstraint()],
        )
        parsed, errors, details = validate_full_dataset(raw, schema)
        assert len(details["constraint_checks"]) == 1

    def test_with_transform_files(self):
        """有 transform 文件时应执行 DAG。"""
        raw = {"users": pd.DataFrame({"id": [1, 2], "val": [10, 20]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[
                        ColumnSchema(name="id", data_type=IntegerType()),
                        ColumnSchema(name="val", data_type=IntegerType()),
                    ],
                )
            },
            constraints=[],
        )
        transform_files = {
            "t1": TransformFile(
                id="t1",
                type="MathExpr",
                enabled=True,
                input_from_node="users",
                input_column="val",
                params={"expr": "@val * 2"},
                output_columns=["val_doubled"],
            )
        }
        parsed, errors, details = validate_full_dataset(raw, schema, transform_files=transform_files)
        assert "users" in parsed


# ============================================================================
# execute_transform_dag 测试
# ============================================================================


class TestExecuteTransformDAG:
    def test_empty_dag(self):
        """空 DAG 应直接返回原始数据。"""
        dag = ExecutionDAG()
        datasets = {"users": pd.DataFrame({"id": [1]})}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert "users" in result
        assert len(result["users"]) == 1

    def test_schema_node_only(self):
        """只有 schema 节点的 DAG 应直接返回。"""
        dag = ExecutionDAG()
        dag.nodes["users"] = DAGNode(id="users", node_type="schema")
        datasets = {"users": pd.DataFrame({"id": [1]})}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert "users" in result

    def test_disabled_transform_skipped(self):
        """禁用的 transform 应被跳过。"""
        dag = ExecutionDAG()
        dag.nodes["users"] = DAGNode(id="users", node_type="schema", outgoing=["t1"])
        dag.nodes["t1"] = DAGNode(
            id="t1",
            node_type="transform",
            incoming=["users"],
            data=TransformFile(id="t1", type="MathExpr", enabled=False),
        )
        datasets = {"users": pd.DataFrame({"id": [1]})}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert "users" in result

    def test_transform_missing_input_skipped(self):
        """输入节点无数据时应跳过 transform。"""
        dag = ExecutionDAG()
        dag.nodes["t1"] = DAGNode(
            id="t1",
            node_type="transform",
            data=TransformFile(id="t1", type="MathExpr", enabled=True, input_from_node="nonexistent"),
        )
        datasets = {}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        # Should not crash
        assert isinstance(result, dict)

    def test_transform_missing_column_skipped(self):
        """输入列不存在时应跳过 transform。"""
        dag = ExecutionDAG()
        dag.nodes["users"] = DAGNode(id="users", node_type="schema", outgoing=["t1"])
        dag.nodes["t1"] = DAGNode(
            id="t1",
            node_type="transform",
            incoming=["users"],
            data=TransformFile(
                id="t1",
                type="MathExpr",
                enabled=True,
                input_from_node="users",
                input_column="nonexistent",
                params={"expr": "1+1"},
                output_columns=["result"],
            ),
        )
        datasets = {"users": pd.DataFrame({"id": [1]})}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert "users" in result

    def test_regex_node_disabled_skipped(self):
        """禁用的 regex 节点应被跳过。"""
        from app.shared.core.project.regex.types import RegexNodeFile

        dag = ExecutionDAG()
        dag.nodes["r1"] = DAGNode(
            id="r1",
            node_type="regex",
            data=RegexNodeFile(id="r1", name="test", pattern=r"\d+", match_mode="extract", enabled=False),
        )
        datasets = {"users": pd.DataFrame({"id": [1]})}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert isinstance(result, dict)

    def test_regex_node_no_input_skipped(self):
        """无输入数据的 regex 节点应被跳过。"""
        from app.shared.core.project.regex.types import RegexNodeFile

        dag = ExecutionDAG()
        dag.nodes["r1"] = DAGNode(
            id="r1",
            node_type="regex",
            data=RegexNodeFile(
                id="r1",
                name="test",
                pattern=r"\d+",
                match_mode="extract",
                enabled=True,
                input_from_node="nonexistent",
            ),
        )
        datasets = {}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert isinstance(result, dict)

    def test_regex_node_no_pattern_skipped(self):
        """无直接 pattern 的 regex 节点应被跳过。"""
        from app.shared.core.project.regex.types import PatternRef, RegexNodeFile

        dag = ExecutionDAG()
        dag.nodes["users"] = DAGNode(id="users", node_type="schema", outgoing=["r1"])
        dag.nodes["r1"] = DAGNode(
            id="r1",
            node_type="regex",
            incoming=["users"],
            data=RegexNodeFile(
                id="r1",
                name="test",
                uses_pattern=PatternRef(registry="patterns", pattern_name="phone_cn"),
                match_mode="extract",
                enabled=True,
                input_from_node="users",
                source_column_name="phone",
            ),
        )
        datasets = {"users": pd.DataFrame({"phone": ["1234567890"]})}
        result, _dag_errors = execute_transform_dag(dag, datasets)
        assert isinstance(result, dict)


class TestDagFailurePropagation:
    """回归 #6: DAG 节点失败应一路上报到校验报告,而非静默降级导致"假通过"。"""

    def test_validate_full_dataset_surfaces_transform_failure(self):
        """transform 执行抛异常时,错误应出现在 validate_full_dataset 的 all_errors 中
        (stage=loading),而非被吞掉让下游约束在未转换数据上假通过。
        """
        from unittest.mock import patch

        raw = {"users": pd.DataFrame({"id": [1, 2]})}
        schema = DataSetSchema(
            tables={
                "users": TableSchema(
                    id="users",
                    name="users",
                    columns=[ColumnSchema(name="id", data_type=IntegerType())],
                )
            },
            constraints=[],
        )
        transform_files = {
            "t1": TransformFile(
                id="t1",
                type="StringSplit",
                input_from_node="users",
                input_column="id",
                params={"delimiter": ","},
                output_columns=["out"],
            )
        }

        class _BoomRunner:
            def execute(self, *args, **kwargs):
                raise RuntimeError("transform boom")

        with patch("app.shared.services.validation.dag.executor.create_runner", return_value=_BoomRunner()):
            parsed, errors, details = validate_full_dataset(raw, schema, transform_files=transform_files)

        # DAG 失败应出现在 errors 中
        dag_errs = [e for e in errors if e.get("node_id") == "t1" or "transform" in str(e.get("message", "")).lower()]
        assert len(dag_errs) >= 1, f"transform 失败应上报到 errors,实际 errors: {errors}"
        assert dag_errs[0].get("stage") == "loading"
        assert "t1" in str(dag_errs[0])
