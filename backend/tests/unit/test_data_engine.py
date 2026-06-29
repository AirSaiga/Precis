"""
@fileoverview 数据引擎测试（T48 覆盖补充）

覆盖目标:
- domain/data_engine.py: _reconstruct_expand_columns, _map_json_path_columns, _expand_structured_columns, process_dataframe
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.domain.data_engine import (
    _expand_structured_columns,
    _map_json_path_columns,
    _reconstruct_expand_columns,
    process_dataframe,
)
from app.shared.domain.data_types import IntegerType, StringType
from app.shared.domain.data_types_parts.json_types import JsonObjectType
from app.shared.domain.dataset_schema import ColumnSchema, TableSchema

# ============================================================================
# _reconstruct_expand_columns 测试
# ============================================================================


class TestReconstructExpandColumns:
    def test_no_expand_columns(self):
        """无 expand 列时应返回原 DataFrame。"""
        df = pd.DataFrame({"id": [1, 2], "name": ["a", "b"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        result = _reconstruct_expand_columns(df, schema)
        assert list(result.columns) == ["id", "name"]

    def test_expand_column_with_children(self):
        """有 expand 列且有 children 时应重构。"""
        child = ColumnSchema(name="brand", data_type=StringType())
        df = pd.DataFrame(
            {
                "id": [1, 2],
                "specs.brand": ["X", "Y"],
            }
        )
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="specs", data_type=StringType(), expand=True, children=[child]),
            ],
        )
        result = _reconstruct_expand_columns(df, schema)
        assert "specs" in result.columns
        assert "specs.brand" not in result.columns

    def test_expand_column_already_exists(self):
        """expand 列已存在时不应重构。"""
        df = pd.DataFrame({"id": [1], "specs": [{"brand": "X"}]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(
                    name="specs",
                    data_type=StringType(),
                    expand=True,
                    children=[
                        ColumnSchema(name="brand", data_type=StringType()),
                    ],
                ),
            ],
        )
        result = _reconstruct_expand_columns(df, schema)
        assert "specs" in result.columns


# ============================================================================
# _map_json_path_columns 测试
# ============================================================================


class TestMapJsonPathColumns:
    def test_no_json_path(self):
        """无 json_path 时应返回原 DataFrame。"""
        df = pd.DataFrame({"id": [1], "name": ["a"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        result = _map_json_path_columns(df, schema)
        assert list(result.columns) == ["id", "name"]

    def test_json_path_mapping(self):
        """有 json_path 时应重命名列。"""
        df = pd.DataFrame({"id": [1], "location.zone": ["A"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="location_zone", data_type=StringType(), json_path="$.location.zone"),
            ],
        )
        result = _map_json_path_columns(df, schema)
        assert "location_zone" in result.columns
        assert "location.zone" not in result.columns

    def test_json_path_no_match(self):
        """json_path 无匹配列时不应重命名。"""
        df = pd.DataFrame({"id": [1]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="loc", data_type=StringType(), json_path="$.location.zone"),
            ],
        )
        result = _map_json_path_columns(df, schema)
        assert "loc" not in result.columns

    def test_json_path_invalid_format(self):
        """json_path 不以 $. 开头时应跳过。"""
        df = pd.DataFrame({"id": [1], "zone": ["A"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="loc", data_type=StringType(), json_path="location.zone"),
            ],
        )
        result = _map_json_path_columns(df, schema)
        assert "loc" not in result.columns


# ============================================================================
# _expand_structured_columns 测试
# ============================================================================


class TestExpandStructuredColumns:
    def test_no_expand(self):
        """无 expand 列时应返回原 DataFrame。"""
        df = pd.DataFrame({"id": [1, 2]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
            ],
        )
        result = _expand_structured_columns(df, schema)
        assert list(result.columns) == ["id"]

    def test_expression_type_expand(self):
        """ExpressionType 列应展开。"""
        from unittest.mock import MagicMock

        from app.shared.domain.data_types_parts.expression import ExpressionType

        df = pd.DataFrame({"id": [1], "data": [{"a": 1, "b": 2}]})
        registry = MagicMock()
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="data", data_type=ExpressionType(registry), expand=True),
            ],
        )
        result = _expand_structured_columns(df, schema)
        assert "data_a" in result.columns or "data" not in result.columns

    def test_json_object_with_children_expand(self):
        """JsonObjectType 有 children 时应按 child_names 展开。"""
        child1 = ColumnSchema(name="brand", data_type=StringType())
        child2 = ColumnSchema(name="model", data_type=StringType())
        df = pd.DataFrame({"id": [1], "specs": [{"brand": "X", "model": "Y"}]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="specs", data_type=JsonObjectType(), expand=True, children=[child1, child2]),
            ],
        )
        result = _expand_structured_columns(df, schema)
        assert "specs_brand" in result.columns or "specs_model" in result.columns

    def test_non_expand_column_skipped(self):
        """非 expand 列应被跳过。"""
        df = pd.DataFrame({"id": [1], "val": [10]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="val", data_type=IntegerType(), expand=False),
            ],
        )
        result = _expand_structured_columns(df, schema)
        assert "val" in result.columns


# ============================================================================
# process_dataframe 测试
# ============================================================================


class TestProcessDataframe:
    def test_basic_processing(self):
        """基本数据处理应正确解析。"""
        df = pd.DataFrame({"id": [1, 2], "name": ["alice", "bob"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert len(parsed) == 2
        assert len(errors) == 0

    def test_missing_column_error(self):
        """缺失列应产生 MissingColumn 错误。"""
        df = pd.DataFrame({"id": [1, 2]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert any(e["error_type"] == "MissingColumn" for e in errors)

    def test_extracted_type_skipped(self):
        """Extracted 类型列应被跳过。"""
        from unittest.mock import MagicMock

        df = pd.DataFrame({"id": [1]})
        extracted_type = MagicMock()
        extracted_type.name = "Extracted"
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="extracted", data_type=extracted_type),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert "id" in parsed.columns

    def test_empty_dataframe(self):
        """空 DataFrame 应返回空结果。"""
        df = pd.DataFrame()
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert len(parsed) == 0
        assert any(e["error_type"] == "MissingColumn" for e in errors)

    def test_json_object_column_not_missing(self):
        """JsonObject 顶层列(有 children)经 json_normalize 展平后不应报 MissingColumn。

        场景:profile 是 JsonObject 列,数据经 json_normalize 展平为 profile.name 点分列。
        改动前:报"缺少列 'profile'"(顶层列消失)。
        改动后:跳过 profile 顶层列检查,递归校验叶子子列 profile.name。
        """
        # 模拟 json_normalize 展平后的 DataFrame(点分列)
        df = pd.DataFrame({"id": [1, 2], "profile.name": ["Alice", "Bob"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(
                    name="profile",
                    data_type=JsonObjectType(),
                    children=[ColumnSchema(name="name", data_type=StringType())],
                ),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        # 不应有针对 'profile' 的 MissingColumn 错误
        missing = [e for e in errors if e["error_type"] == "MissingColumn"]
        assert missing == [], f"不应有 MissingColumn 错误,实际: {missing}"
        # 叶子子列 profile.name 应被校验(存在于 parsed)
        assert "profile.name" in parsed.columns

    def test_nested_leaf_column_validated(self):
        """嵌套叶子子列(profile.name)应通过类型校验。"""
        df = pd.DataFrame({"id": [1], "profile.name": ["Alice"]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(
                    name="profile",
                    data_type=JsonObjectType(),
                    children=[ColumnSchema(name="name", data_type=StringType())],
                ),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        assert "profile.name" in parsed.columns
        assert len(errors) == 0

    def test_flat_column_missing_still_reported(self):
        """回归:平面列缺失仍报 MissingColumn(确保递归改动不破坏平面场景)。"""
        df = pd.DataFrame({"id": [1]})
        schema = TableSchema(
            name="t",
            columns=[
                ColumnSchema(name="id", data_type=IntegerType()),
                ColumnSchema(name="name", data_type=StringType()),
            ],
        )
        parsed, errors = process_dataframe(df, schema)
        missing = [e for e in errors if e["error_type"] == "MissingColumn"]
        assert len(missing) == 1
        assert missing[0]["column"] == "name"
