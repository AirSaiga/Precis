"""
@fileoverview 全量校验引擎行为测试

覆盖 table_filter 过滤与 deadline 超时场景。
"""

from __future__ import annotations

import time

import pandas as pd

from app.shared.domain.constraints import NotNullConstraint
from app.shared.domain.data_types import StringType
from app.shared.domain.dataset_schema import ColumnSchema, DataSetSchema, TableSchema
from app.shared.services.validation.engine import validate_full_dataset


class TestValidateFullDataset:
    """validate_full_dataset 行为测试"""

    def _make_schema(self):
        return DataSetSchema(
            tables={
                "table_1": TableSchema(
                    id="table_1",
                    name="Table 1",
                    columns=[ColumnSchema(name="col_a", id="col_a", data_type=StringType())],
                ),
                "table_2": TableSchema(
                    id="table_2",
                    name="Table 2",
                    columns=[ColumnSchema(name="col_b", id="col_b", data_type=StringType())],
                ),
            },
            constraints=[
                NotNullConstraint(table="table_1", column="col_a"),
                NotNullConstraint(table="table_2", column="col_b"),
            ],
        )

    def test_table_filter_as_list_skips_other_tables(self):
        schema = self._make_schema()
        raw = {
            "table_1": pd.DataFrame({"col_a": ["x"]}),
            "table_2": pd.DataFrame({"col_b": [None]}),
        }
        parsed, errors, details = validate_full_dataset(raw, schema, table_filter=["table_1"])
        assert "table_1" in parsed
        # table_2 的约束被跳过，因此不应产生 table_2 的 NotNull 错误
        table_2_errors = [e for e in errors if e.get("table") == "table_2"]
        assert len(table_2_errors) == 0
        # 校验详情应包含 table_1 的 format check
        assert any(c["table"] == "table_1" for c in details["format_checks"])

    def test_deadline_triggered_timeout(self):
        schema = self._make_schema()
        raw = {
            "table_1": pd.DataFrame({"col_a": ["ok"]}),
            "table_2": pd.DataFrame({"col_b": ["ok"]}),
        }
        past_deadline = time.monotonic() - 9999
        _, errors, _ = validate_full_dataset(raw, schema, deadline=past_deadline)
        timeout_errors = [e for e in errors if e.get("error_type") == "Timeout"]
        assert len(timeout_errors) >= 1
        assert "超时" in timeout_errors[0]["message"]
