"""
@fileoverview validation/loader.py 单元测试

测试范围:
- load_file_data: Excel/CSV/JSON/JSONL 加载、文件不存在、不支持类型
- load_file_data: 带配置加载、编码/分隔符设置
"""

import pandas as pd
import pytest

from app.shared.services.validation.loader import load_file_data


class TestLoadFileDataFileNotFound:
    def test_nonexistent_file_raises(self):
        with pytest.raises(FileNotFoundError, match="文件不存在"):
            load_file_data("/nonexistent/file.csv")


class TestLoadFileDataCSV:
    def test_basic_csv(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id,name\n1,alice\n2,bob\n", encoding="utf-8")
        df = load_file_data(str(csv_file))
        assert len(df) == 2
        assert list(df.columns) == ["id", "name"]
        assert df.iloc[0]["name"] == "alice"

    def test_csv_with_custom_delimiter(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id;name\n1;alice\n", encoding="utf-8")
        df = load_file_data(str(csv_file), source_config={"delimiter": ";"})
        assert len(df) == 1
        assert list(df.columns) == ["id", "name"]

    def test_csv_no_header(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("1,alice\n2,bob\n", encoding="utf-8")
        df = load_file_data(str(csv_file), header_row=-1)
        assert len(df) == 2

    def test_csv_nan_cleaned(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id,name\n1,\n2,bob\n", encoding="utf-8")
        df = load_file_data(str(csv_file))
        # Empty CSV cells become empty string → replaced with None
        assert df.iloc[0]["name"] is None or (isinstance(df.iloc[0]["name"], float) and pd.isna(df.iloc[0]["name"]))
        assert df.iloc[1]["name"] == "bob"


class TestLoadFileDataExcel:
    def test_basic_excel(self, tmp_path):
        excel_file = tmp_path / "test.xlsx"
        df_input = pd.DataFrame({"id": [1, 2], "name": ["alice", "bob"]})
        df_input.to_excel(str(excel_file), index=False)
        df = load_file_data(str(excel_file))
        assert len(df) == 2
        assert list(df.columns) == ["id", "name"]

    def test_excel_with_sheet_name(self, tmp_path):
        excel_file = tmp_path / "test.xlsx"
        df_input = pd.DataFrame({"a": [1]})
        with pd.ExcelWriter(str(excel_file)) as writer:
            df_input.to_excel(writer, sheet_name="Sheet1", index=False)
            pd.DataFrame({"b": [2]}).to_excel(writer, sheet_name="MySheet", index=False)
        df = load_file_data(str(excel_file), sheet_name="MySheet")
        assert list(df.columns) == ["b"]


class TestLoadFileDataJSON:
    def test_json_array(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('[{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]', encoding="utf-8")
        df = load_file_data(str(json_file))
        assert len(df) == 2
        assert "id" in df.columns

    def test_jsonl(self, tmp_path):
        jsonl_file = tmp_path / "test.jsonl"
        jsonl_file.write_text('{"id": 1}\n{"id": 2}\n', encoding="utf-8")
        df = load_file_data(str(jsonl_file))
        assert len(df) == 2

    def test_json_nested_object(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('{"a": 1, "b": 2}', encoding="utf-8")
        df = load_file_data(str(json_file))
        # Nested object gets flattened or loaded as single row
        assert len(df) >= 1


class TestLoadFileDataUnsupported:
    def test_unsupported_extension_raises(self, tmp_path):
        txt_file = tmp_path / "test.txt"
        txt_file.write_text("hello")
        with pytest.raises(ValueError, match="不支持的文件类型"):
            load_file_data(str(txt_file))


class TestLoadFileDataWithSettings:
    def test_csv_with_settings(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        class MockSettings:
            default_encoding = "utf-8"
            csv_delimiter = ","

        df = load_file_data(str(csv_file), settings=MockSettings())
        assert len(df) == 1

    def test_csv_settings_auto_encoding(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id\n1\n", encoding="utf-8")

        class MockSettings:
            default_encoding = "auto"
            csv_delimiter = "auto"

        df = load_file_data(str(csv_file), settings=MockSettings())
        assert len(df) == 1

    def test_no_settings(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("id\n1\n", encoding="utf-8")
        df = load_file_data(str(csv_file))
        assert len(df) == 1

    def test_file_not_found(self):
        with pytest.raises(FileNotFoundError, match="文件不存在"):
            load_file_data("/nonexistent.csv")

    def test_unsupported_type(self, tmp_path):
        txt_file = tmp_path / "test.txt"
        txt_file.write_text("hello")
        with pytest.raises(ValueError, match="不支持的文件类型"):
            load_file_data(str(txt_file))

    def test_json_format(self, tmp_path):
        json_file = tmp_path / "test.json"
        json_file.write_text('[{"id": 1}]', encoding="utf-8")
        df = load_file_data(str(json_file), source_config={"format": "array"})
        assert len(df) == 1

    def test_jsonl_format(self, tmp_path):
        jsonl_file = tmp_path / "test.jsonl"
        jsonl_file.write_text('{"id": 1}\n{"id": 2}\n', encoding="utf-8")
        df = load_file_data(str(jsonl_file))
        assert len(df) == 2

    def test_excel_format(self, tmp_path):
        excel_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": [1]}).to_excel(str(excel_file), index=False)
        df = load_file_data(str(excel_file))
        assert len(df) == 1

    def test_csv_no_header(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("1,alice\n2,bob\n", encoding="utf-8")
        df = load_file_data(str(csv_file), header_row=-1)
        assert len(df) == 2
