"""
@fileoverview Schema 类型定义模块单元测试

测试 column, source, table, source_options 中的 Pydantic 模型。
"""

import pytest
from pydantic import ValidationError

from app.shared.core.project.schema.types_parts.column import ColumnSpec, ExtractedSpec
from app.shared.core.project.schema.types_parts.source import SourceSpec
from app.shared.core.project.schema.types_parts.source_options import (
    CSVOptions,
    ExcelOptions,
    JSONOptions,
    create_format_options,
    get_options_type,
)
from app.shared.core.project.schema.types_parts.table import TableSchemaFile


class TestExtractedSpec:
    def test_create(self):
        e = ExtractedSpec(source_column="email", extract_key="username")
        assert e.name == "Extracted"
        assert e.result_type is None


class TestColumnSpec:
    def test_id_auto_from_name(self):
        c = ColumnSpec(name="age", type="integer")
        assert c.id == "age"

    def test_id_preserved_when_provided(self):
        c = ColumnSpec(id="col_1", name="age", type="integer")
        assert c.id == "col_1"

    def test_defaults(self):
        c = ColumnSpec(name="x", type="string")
        assert c.primary_key is False
        assert c.expand is False
        assert c.json_path is None


class TestSourceSpec:
    def test_normalize_path(self):
        s = SourceSpec(mode="relative_file", path="data\\users.xlsx")
        assert s.path == "data/users.xlsx"

    def test_is_json_true(self):
        s = SourceSpec(mode="relative_file", path="data/users.json")
        assert s.is_json() is True

    def test_is_json_false(self):
        s = SourceSpec(mode="relative_file", path="data/users.csv")
        assert s.is_json() is False

    def test_get_file_extension(self):
        s = SourceSpec(mode="relative_file", path="data/users.xlsx")
        assert s.get_file_extension() == "xlsx"

    def test_get_file_extension_no_dot(self):
        s = SourceSpec(mode="relative_file", path="data/users")
        assert s.get_file_extension() == ""

    def test_to_loader_config_basic(self):
        s = SourceSpec(mode="relative_file", path="data.csv", header_row=1)
        config = s.to_loader_config()
        assert config["path"] == "data.csv"
        assert config["mode"] == "relative"
        assert config["header_row"] == 1

    def test_to_loader_config_with_options(self):
        s = SourceSpec(
            mode="absolute_file",
            path="data.json",
            options=JSONOptions(format="array", json_path="$.items"),
        )
        config = s.to_loader_config()
        assert config["type"] == "json"
        assert config["format"] == "array"


class TestTableSchemaFile:
    def test_create_minimal(self):
        t = TableSchemaFile(id="users", name="用户表")
        assert t.version == 2
        assert t.columns == []

    def test_sheet_conflict_raises(self):
        with pytest.raises(ValidationError, match="不一致"):
            TableSchemaFile(
                id="users",
                name="用户表",
                source=SourceSpec(mode="relative_file", path="data.xlsx", sheet="Sheet1"),
                sheet="Sheet2",
            )

    def test_sheet_same_value_ok(self):
        t = TableSchemaFile(
            id="users",
            name="用户表",
            source=SourceSpec(mode="relative_file", path="data.xlsx", sheet="Sheet1"),
            sheet="Sheet1",
        )
        assert t.sheet == "Sheet1"

    def test_duplicate_column_id_raises(self):
        with pytest.raises(ValidationError, match="columns.id 必须唯一"):
            TableSchemaFile(
                id="users",
                name="用户表",
                columns=[
                    ColumnSpec(id="a", name="x", type="string"),
                    ColumnSpec(id="a", name="y", type="string"),
                ],
            )

    def test_duplicate_column_name_raises(self):
        with pytest.raises(ValidationError, match="columns.name 必须唯一"):
            TableSchemaFile(
                id="users",
                name="用户表",
                columns=[
                    ColumnSpec(id="a", name="x", type="string"),
                    ColumnSpec(id="b", name="x", type="string"),
                ],
            )

    def test_duplicate_constraint_id_raises(self):
        from app.shared.core.project.schema.types_parts.constraint import ConstraintItem

        with pytest.raises(ValidationError, match="constraints.id 必须唯一"):
            TableSchemaFile(
                id="users",
                name="用户表",
                constraints=[
                    ConstraintItem(id="c1", type="NotNull"),
                    ConstraintItem(id="c1", type="Unique"),
                ],
            )


class TestFormatOptions:
    def test_json_options_loader_config(self):
        j = JSONOptions(format="object", json_path="$.data", sep="-")
        cfg = j.to_loader_config()
        assert cfg["type"] == "json"
        assert cfg["format"] == "object"
        assert cfg["json_path"] == "$.data"
        assert cfg["sep"] == "-"

    def test_csv_options_loader_config(self):
        c = CSVOptions(delimiter=";", encoding="gbk")
        cfg = c.to_loader_config()
        assert cfg["type"] == "csv"
        assert cfg["delimiter"] == ";"
        assert cfg["encoding"] == "gbk"

    def test_excel_options_loader_config(self):
        e = ExcelOptions(engine="xlrd", dtype_inference=False)
        cfg = e.to_loader_config()
        assert cfg["type"] == "excel"
        assert cfg["engine"] == "xlrd"
        assert cfg["dtype_inference"] is False

    def test_create_format_options_json(self):
        opts = create_format_options(".json", {"format": "array"})
        assert isinstance(opts, JSONOptions)

    def test_create_format_options_csv(self):
        opts = create_format_options(".csv", {"delimiter": ";"})
        assert isinstance(opts, CSVOptions)

    def test_create_format_options_excel(self):
        opts = create_format_options(".xlsx", {"engine": "openpyxl"})
        assert isinstance(opts, ExcelOptions)

    def test_create_format_options_none_dict(self):
        opts = create_format_options(".json", None)
        assert opts is None

    def test_create_format_options_unknown_ext(self):
        opts = create_format_options(".txt", {"foo": "bar"})
        assert opts is None

    def test_get_options_type(self):
        assert get_options_type(JSONOptions()) == "JSONOptions"
        assert get_options_type(None) == "None"
