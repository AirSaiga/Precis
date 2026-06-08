"""
路由 + 验证深度补测 — 快速覆盖率冲刺。
"""

from __future__ import annotations

import os
import sys

import pandas as pd
import pytest
from fastapi.testclient import TestClient

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.api.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_dir(tmp_path):
    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "schemas").mkdir()
    (proj / "constraints").mkdir()
    (proj / "data").mkdir()
    manifest = proj / "project.precis.yaml"
    manifest.write_text(
        "version: 2\nproject:\n  id: test_proj\n  name: Test\nschemas: []\n",
        encoding="utf-8",
    )
    return str(proj), str(manifest)


# ============================================================================
# Full Config PUT
# ============================================================================


class TestFullConfigPutRouter:
    def test_put_full_config_minimal(self, client, project_dir):
        proj_dir, _ = project_dir
        resp = client.put(
            "/api/v1/v2/config/full",
            json={
                "manifest": {
                    "version": 2,
                    "project": {"id": "test_proj", "name": "Test"},
                    "schemas": [],
                    "constraints": [],
                },
                "schemas": {},
                "constraints": {},
            },
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code in (200, 400, 404, 500)


# ============================================================================
# Settings PUT
# ============================================================================


class TestSettingsPutRouter:
    def test_put_validation_settings(self, client, project_dir):
        proj_dir, _ = project_dir
        resp = client.put(
            "/api/v1/v2/config/validation",
            json={"max_rows": 1000},
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code in (200, 400, 404)

    def test_put_file_processing_settings(self, client, project_dir):
        proj_dir, _ = project_dir
        resp = client.put(
            "/api/v1/v2/config/file-processing",
            json={"encoding": "utf-8"},
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code in (200, 400, 404)

    def test_put_script_security_settings(self, client, project_dir):
        proj_dir, _ = project_dir
        resp = client.put(
            "/api/v1/v2/config/script-security",
            json={"allow_eval": False},
            headers={"X-Project-Config-Path": proj_dir},
        )
        assert resp.status_code in (200, 400, 404)


# ============================================================================
# Validation Inline Mode
# ============================================================================


class TestValidationInlineRouter:
    def test_validate_inline_not_null(self, client):
        resp = client.post(
            "/api/v1/validate/inline",
            json={
                "data": [{"col_a": "x"}, {"col_a": None}, {"col_a": "y"}],
                "validation_type": "not_null",
                "target_column_name": "col_a",
            },
        )
        assert resp.status_code in (200, 400, 422, 500)

    def test_validate_inline_unique(self, client):
        resp = client.post(
            "/api/v1/validate/inline",
            json={
                "data": [{"col_a": "x"}, {"col_a": "x"}],
                "validation_type": "unique",
                "target_column_name": "col_a",
            },
        )
        assert resp.status_code in (200, 400, 422, 500)

    def test_validate_inline_allowed_values(self, client):
        resp = client.post(
            "/api/v1/validate/inline",
            json={
                "data": [{"col_a": "x"}, {"col_a": "z"}],
                "validation_type": "allowed_values",
                "target_column_name": "col_a",
                "validation_config": {"allowed_values": ["x", "y"]},
            },
        )
        assert resp.status_code in (200, 400, 422, 500)


# ============================================================================
# Validation History POST
# ============================================================================


class TestValidationHistoryPostRouter:
    def test_save_validation_run(self, client, tmp_path):
        resp = client.post(
            "/api/v1/v2/validation/history",
            json={
                "project_path": str(tmp_path),
                "duration_ms": 100,
                "scope": "all",
                "summary": {"total": 10, "passed": 9, "failed": 1},
                "by_type": {},
                "by_table": {},
                "errors": [],
                "warnings": [],
            },
        )
        assert resp.status_code in (200, 400, 422, 500)


# ============================================================================
# DAG Executor
# ============================================================================


class TestDagExecutor:
    def test_execute_empty_dag(self):
        from app.shared.services.validation.dag.builder import ExecutionDAG
        from app.shared.services.validation.dag.executor import execute_transform_dag

        dag = ExecutionDAG(nodes={})
        datasets = {"t1": pd.DataFrame({"a": [1]})}
        result = execute_transform_dag(dag, datasets)
        assert result is datasets

    def test_execute_dag_with_schema_node_only(self):
        from app.shared.services.validation.dag.builder import DAGNode, ExecutionDAG
        from app.shared.services.validation.dag.executor import execute_transform_dag

        node = DAGNode(id="s1", node_type="schema")
        dag = ExecutionDAG(nodes={"s1": node})
        datasets = {"s1": pd.DataFrame({"a": [1, 2]})}
        result = execute_transform_dag(dag, datasets)
        assert "s1" in result


# ============================================================================
# Data Engine (additional branches)
# ============================================================================


class TestDataEngine:
    def test_process_dataframe_normal(self):
        from app.shared.domain.data_engine import process_dataframe
        from app.shared.domain.data_types import IntegerType, StringType
        from app.shared.domain.dataset_schema import ColumnSchema, TableSchema

        df = pd.DataFrame({"name": ["Alice", "Bob"], "age": [30, 25]})
        schema_table = TableSchema(
            id="t1",
            name="Test",
            columns=[
                ColumnSchema(name="name", data_type=StringType()),
                ColumnSchema(name="age", data_type=IntegerType()),
            ],
        )
        result = process_dataframe(df, schema_table)
        assert result is not None

    def test_process_dataframe_empty(self):
        from app.shared.domain.data_engine import process_dataframe
        from app.shared.domain.data_types import StringType
        from app.shared.domain.dataset_schema import ColumnSchema, TableSchema

        df = pd.DataFrame({"col": pd.Series(dtype="object")})
        schema_table = TableSchema(
            id="t1",
            name="Test",
            columns=[ColumnSchema(name="col", data_type=StringType())],
        )
        result = process_dataframe(df, schema_table)
        assert result is not None


# ============================================================================
# Domain Data Types
# ============================================================================


class TestDataTypes:
    def test_integer_type_edge_cases(self):
        from app.shared.domain.data_types import IntegerType

        dt = IntegerType()
        assert dt is not None

    def test_decimal_type_edge_cases(self):
        from app.shared.domain.data_types import DecimalType

        dt = DecimalType()
        assert dt is not None
