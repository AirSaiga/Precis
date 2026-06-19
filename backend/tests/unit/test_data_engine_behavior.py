"""
@fileoverview 数据处理引擎行为测试

覆盖 process_dataframe 正常处理与空 DataFrame。
"""

from __future__ import annotations

import pandas as pd

from app.shared.domain.data_engine import process_dataframe
from app.shared.domain.data_types import IntegerType, StringType
from app.shared.domain.dataset_schema import ColumnSchema, TableSchema


class TestProcessDataframe:
    """process_dataframe 行为"""

    def test_processes_valid_data(self):
        df = pd.DataFrame({"name": ["Alice", "Bob"], "age": ["30", "25"]})
        schema = TableSchema(
            id="t1",
            name="Test",
            columns=[
                ColumnSchema(name="name", id="name", data_type=StringType()),
                ColumnSchema(name="age", id="age", data_type=IntegerType()),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert len(parsed) == 2
        assert parsed["age"].iloc[0] == 30
        assert len(errors) == 0

    def test_processes_empty_dataframe(self):
        df = pd.DataFrame({"col": pd.Series(dtype="object")})
        schema = TableSchema(
            id="t1",
            name="Test",
            columns=[ColumnSchema(name="col", id="col", data_type=StringType())],
        )
        parsed, errors = process_dataframe(df, schema)
        assert parsed is not None
        assert len(parsed) == 0
