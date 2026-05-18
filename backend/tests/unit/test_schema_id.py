"""
@fileoverview Schema ID 生成与解析单元测试

测试 schema_id 模块的编码、解码、路径规范化功能。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


from app.shared.core.project.schema.types_parts import schema_id as schema_id_mod


class TestNormalizeRelPathKey:
    def test_simple_path(self):
        assert schema_id_mod._normalize_rel_path_key("data/users.xlsx") == "data/users.xlsx"

    def test_backslash_conversion(self):
        assert schema_id_mod._normalize_rel_path_key("data\\users.xlsx") == "data/users.xlsx"

    def test_dot_slash_prefix(self):
        assert schema_id_mod._normalize_rel_path_key("./data/users.xlsx") == "data/users.xlsx"

    def test_root_prefix_stripped(self):
        original_root = schema_id_mod.SCHEMA_SOURCE_ROOT_TEST
        try:
            schema_id_mod.SCHEMA_SOURCE_ROOT_TEST = "project"
            assert schema_id_mod._normalize_rel_path_key("project/data/users.xlsx") == "data/users.xlsx"
            assert schema_id_mod._normalize_rel_path_key("project") == ""
        finally:
            schema_id_mod.SCHEMA_SOURCE_ROOT_TEST = original_root

    def test_empty_path(self):
        assert schema_id_mod._normalize_rel_path_key("") == "."
        assert schema_id_mod._normalize_rel_path_key(None) == "."


class TestNormalizeSheetKey:
    def test_excel_sheet(self):
        assert schema_id_mod._normalize_sheet_key("data/users.xlsx", "Sheet1") == "sheet1"

    def test_excel_none_sheet(self):
        assert schema_id_mod._normalize_sheet_key("data/users.xlsx", None) == ""

    def test_csv_stem(self):
        assert schema_id_mod._normalize_sheet_key("data/users.csv", None) == "users"

    def test_xls(self):
        assert schema_id_mod._normalize_sheet_key("data/old.xls", "Tab1") == "tab1"


class TestXorBytes:
    def test_roundtrip(self):
        data = b"hello world"
        secret = "key"
        xored = schema_id_mod._xor_bytes(data, secret)
        assert xored != data
        restored = schema_id_mod._xor_bytes(xored, secret)
        assert restored == data

    def test_empty_secret(self):
        data = b"unchanged"
        assert schema_id_mod._xor_bytes(data, "") == data


class TestEncodeDecodeSchemaRawId:
    def test_roundtrip(self):
        raw = "data/users.xlsx|sheet1"
        encoded = schema_id_mod.encode_schema_raw_id(raw)
        assert encoded.startswith("sc_")
        decoded = schema_id_mod.decode_schema_id(encoded)
        assert decoded == raw

    def test_decode_invalid_prefix(self):
        assert schema_id_mod.decode_schema_id("invalid") is None
        assert schema_id_mod.decode_schema_id("") is None
        assert schema_id_mod.decode_schema_id(None) is None

    def test_decode_bad_base64(self):
        result = schema_id_mod.decode_schema_id("sc_!!!")
        assert result is None or result == ""

    def test_encode_empty(self):
        encoded = schema_id_mod.encode_schema_raw_id("")
        assert encoded.startswith("sc_")
        assert schema_id_mod.decode_schema_id(encoded) == ""


class TestBuildSchemaRawId:
    def test_basic(self):
        raw = schema_id_mod.build_schema_raw_id("data/users.xlsx", "Sheet1")
        assert raw == "data/users.xlsx|sheet1"

    def test_csv_no_sheet(self):
        raw = schema_id_mod.build_schema_raw_id("data/users.csv", None)
        assert raw == "data/users.csv|users"


class TestGenerateSchemaId:
    def test_basic(self):
        sid = schema_id_mod.generate_schema_id("data/users.xlsx", "Sheet1")
        assert sid.startswith("sc_")
        decoded = schema_id_mod.decode_schema_id(sid)
        assert "data/users.xlsx" in decoded


class TestExtractSheetFromId:
    def test_from_encoded(self):
        sid = schema_id_mod.generate_schema_id("data/users.xlsx", "Sheet1")
        assert schema_id_mod.extract_sheet_from_id(sid) == "sheet1"

    def test_legacy_format(self):
        # Use an ID that fails base64 decode so legacy path is hit
        assert schema_id_mod.extract_sheet_from_id("sc_!-table1") == "table1"

    def test_invalid_id(self):
        assert schema_id_mod.extract_sheet_from_id("nope") is None


class TestIsExcelSchema:
    def test_xlsx_true(self):
        sid = schema_id_mod.generate_schema_id("data/users.xlsx", "Sheet1")
        assert schema_id_mod.is_excel_schema(sid) is True

    def test_xls_true(self):
        sid = schema_id_mod.generate_schema_id("data/users.xls", "Sheet1")
        assert schema_id_mod.is_excel_schema(sid) is True

    def test_csv_false(self):
        sid = schema_id_mod.generate_schema_id("data/users.csv", None)
        assert schema_id_mod.is_excel_schema(sid) is False

    def test_legacy_true(self):
        assert schema_id_mod.is_excel_schema("sc_xxx-sheet") is True

    def test_invalid_false(self):
        assert schema_id_mod.is_excel_schema("bad") is False
