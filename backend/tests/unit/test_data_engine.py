"""
@fileoverview 数据处理引擎单元测试

测试 data_engine.py 的 process_dataframe 和 _expand_structured_columns。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.domain.data_engine import _expand_structured_columns, process_dataframe
from app.shared.domain.data_types import BooleanType, DateType, FloatType, IntegerType, StringType
from app.shared.domain.dataset_schema import ColumnSchema, TableSchema


class TestProcessDataframe:
    def test_basic_validation_and_parse(self):
        df = pd.DataFrame({"age": ["25", "30", "abc"], "name": ["Alice", "Bob", "Charlie"]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="age", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert parsed_df["age"][0] == 25
        assert parsed_df["age"][1] == 30
        assert pd.isna(parsed_df["age"][2])
        assert len(errors) == 1
        assert errors[0]["column"] == "age"
        assert errors[0]["error_type"] == "TypeValidationError"

    def test_missing_column(self):
        df = pd.DataFrame({"name": ["Alice"]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="age", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert len(errors) == 1
        assert errors[0]["error_type"] == "MissingColumn"
        assert errors[0]["column"] == "age"
        assert pd.isna(parsed_df["age"][0])

    def test_no_errors(self):
        df = pd.DataFrame({"age": ["25", "30"], "name": ["Alice", "Bob"]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="age", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert len(errors) == 0
        assert list(parsed_df["age"]) == [25, 30]

    def test_empty_dataframe(self):
        df = pd.DataFrame({"age": [], "name": []})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="age", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert len(parsed_df) == 0
        assert len(errors) == 0

    def test_not_null_violation(self):
        """测试 nullable=False 时空值产生 NotNullViolation 错误"""
        df = pd.DataFrame({"age": ["25", None, ""], "name": ["Alice", "Bob", ""]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="age", data_type=IntegerType(), nullable=False),
                ColumnSchema(name="name", data_type=StringType(), nullable=False),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        notnull_errors = [e for e in errors if e["error_type"] == "NotNullViolation"]
        assert len(notnull_errors) >= 2  # age 的 None 和 name 的空字符串

    def test_float_column(self):
        """测试浮点数列解析"""
        df = pd.DataFrame({"price": ["3.14", "2.0", "abc"], "name": ["A", "B", "C"]})
        schema = TableSchema(
            name="products",
            columns=[
                ColumnSchema(name="price", data_type=FloatType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert parsed_df["price"][0] == 3.14
        assert parsed_df["price"][1] == 2.0
        assert parsed_df["price"][2] is None or pd.isna(parsed_df["price"][2])
        assert len(errors) == 1
        assert errors[0]["error_type"] == "TypeValidationError"

    def test_boolean_column(self):
        """测试布尔列解析"""
        df = pd.DataFrame({"active": ["true", "false", "yes", "invalid"], "name": ["A", "B", "C", "D"]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="active", data_type=BooleanType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert parsed_df["active"][0] is True
        assert parsed_df["active"][1] is False
        assert parsed_df["active"][2] is True
        assert parsed_df["active"][3] is None or pd.isna(parsed_df["active"][3])
        assert len(errors) == 1

    def test_date_column(self):
        """测试日期列解析"""
        df = pd.DataFrame({"dob": ["2024-01-15", "not-a-date", "2024-06-01"], "name": ["A", "B", "C"]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="dob", data_type=DateType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        from datetime import date

        assert parsed_df["dob"][0] == date(2024, 1, 15)
        assert parsed_df["dob"][1] is None or pd.isna(parsed_df["dob"][1])
        assert parsed_df["dob"][2] == date(2024, 6, 1)
        assert len(errors) == 1
        assert errors[0]["error_type"] == "TypeValidationError"

    def test_mixed_valid_invalid_rows(self):
        """测试混合合法/非法行的场景"""
        df = pd.DataFrame({"age": ["10", "abc", "30", "-5", "xyz"], "name": ["A", "B", "C", "D", "E"]})
        schema = TableSchema(
            name="users",
            columns=[
                ColumnSchema(name="age", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed_df, errors = process_dataframe(df, schema)
        assert parsed_df["age"][0] == 10
        assert parsed_df["age"][2] == 30
        assert parsed_df["age"][3] == -5
        type_errors = [e for e in errors if e["error_type"] == "TypeValidationError"]
        assert len(type_errors) == 2  # "abc" 和 "xyz"


class TestExpandStructuredColumns:
    def test_no_expression_columns(self):
        df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
        schema = TableSchema(name="t", columns=[ColumnSchema(name="a", data_type=IntegerType())])
        result = _expand_structured_columns(df, schema)
        pd.testing.assert_frame_equal(result, df)

    def test_expression_column_expand(self):
        df = pd.DataFrame({"json_col": [{"x": 1, "y": 2}, {"x": 3, "y": 4}]})
        import re

        from app.shared.domain.data_types_parts.expression import ExpressionType
        from app.shared.domain.expression_system import ExpressionPattern, ExpressionRegistry

        registry = ExpressionRegistry()
        registry.register(
            ExpressionPattern(
                name="dummy",
                regex=re.compile(r".*"),
                parser_func=lambda d: d,
            )
        )
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="json_col", data_type=ExpressionType(registry), expand=True),
            ],
        )
        result = _expand_structured_columns(df, schema)
        assert "json_col" not in result.columns
        assert "json_col_x" in result.columns
        assert "json_col_y" in result.columns
        assert list(result["json_col_x"]) == [1, 3]
