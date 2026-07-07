"""
@fileoverview 数据集 Schema 模块单元测试

测试 build_type_from_config, ColumnSchema, TableSchema, DataSetSchema, 注册表。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.domain.data_types import IntegerType, SequenceType, StringType
from app.shared.domain.dataset_schema import (
    TYPE_REGISTRY,
    ColumnSchema,
    DataSetSchema,
    TableSchema,
    build_type_from_config,
)


class TestTypeRegistry:
    def test_contains_int(self):
        assert "int" in TYPE_REGISTRY
        assert isinstance(TYPE_REGISTRY["int"], IntegerType)

    def test_contains_string(self):
        assert "string" in TYPE_REGISTRY
        assert isinstance(TYPE_REGISTRY["string"], StringType)

    def test_registry_single_source_of_truth(self):
        """B09 回归：builder / dataset_schema / models 三个导入路径必须指向同一份注册表，
        避免过去副本漂移导致的 JSON-Schema 别名缺失等问题。"""
        from app.shared.domain.schema import builder as builder_mod
        from app.shared.domain.schema import models as models_mod

        # builder 是唯一事实源；models re-export 同一对象
        assert builder_mod.TYPE_REGISTRY is models_mod.TYPE_REGISTRY
        assert builder_mod.TYPE_REGISTRY is TYPE_REGISTRY

    def test_registry_contains_json_schema_aliases(self):
        """B09 回归：JSON-Schema 别名（number/object/array/null）必须存在，
        过去 models.py 副本缺失这些别名导致漂移。"""
        for key in ("number", "object", "array", "null"):
            assert key in TYPE_REGISTRY, f"JSON-Schema 别名缺失: {key}"


class TestBuildTypeFromConfig:
    def test_string_config(self):
        t = build_type_from_config("int")
        assert isinstance(t, IntegerType)

    def test_dict_config_sequence(self):
        t = build_type_from_config({"name": "Sequence", "item_type": "string", "delimiter": ";"})
        assert isinstance(t, SequenceType)

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="未知的类型"):
            build_type_from_config("unknown_type")

    def test_dict_missing_name_raises(self):
        with pytest.raises(ValueError, match="类型配置字典"):
            build_type_from_config({"name": "unknown"})

    def test_invalid_format_raises(self):
        with pytest.raises(TypeError, match="无效的类型配置"):
            build_type_from_config(123)


class TestColumnSchema:
    def test_create(self):
        col = ColumnSchema(name="id", data_type=IntegerType(), is_primary_key=True)
        assert col.name == "id"
        assert col.is_primary_key is True
        assert col.expand is False


class TestTableSchema:
    def test_create_and_get_column(self):
        col = ColumnSchema(name="email", data_type=StringType())
        table = TableSchema(id="users", name="users", columns=[col])
        assert table.get_column("email") is col
        assert table.get_column("missing") is None
        assert table.header_row == 0
        assert table.script_checks == []


class TestDataSetSchema:
    def test_create(self):
        users = TableSchema(id="users", name="users", columns=[ColumnSchema("id", IntegerType())])
        schema = DataSetSchema(tables={"users": users}, constraints=[])
        assert "users" in schema.tables
        assert schema.constraints == []
