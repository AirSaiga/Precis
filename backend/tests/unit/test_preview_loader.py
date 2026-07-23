"""preview/loader.py 单元测试

测试预览专用数据加载器 load_preview_data 的各格式处理路径：
- Excel：加载数据 + 获取工作表名称列表
- CSV：支持 encoding/delimiter 配置
- JSON：支持 array/lines 格式，加载后截断到 max_rows
- 不支持的文件类型抛出 ValueError
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.shared.services.preview.loader import load_preview_data


class TestLoadPreviewDataExcel:
    def test_excel_returns_df_and_sheet_names(self):
        mock_df = pd.DataFrame({"col1": [1, 2, 3]})
        mock_excel_file = MagicMock()
        mock_excel_file.sheet_names = ["Sheet1", "Sheet2"]

        with (
            patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load,
            patch("app.shared.services.preview.loader.pd.ExcelFile", return_value=mock_excel_file),
        ):
            df, sheet_names = load_preview_data("data.xlsx", "excel", 100, sheet_name="Sheet1")

        assert df is mock_df
        assert sheet_names == ["Sheet1", "Sheet2"]
        mock_excel_file.close.assert_called_once()
        # 验证 load_source_data 被调用（spec 参数）
        mock_load.assert_called_once()

    def test_excel_without_sheet_name(self):
        mock_df = pd.DataFrame({"a": [1]})
        mock_excel_file = MagicMock()
        mock_excel_file.sheet_names = ["Sheet1"]

        with (
            patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df),
            patch("app.shared.services.preview.loader.pd.ExcelFile", return_value=mock_excel_file),
        ):
            df, sheet_names = load_preview_data("data.xlsx", "excel", 50)

        assert sheet_names == ["Sheet1"]


class TestLoadPreviewDataCSV:
    def test_csv_returns_df_and_none(self):
        mock_df = pd.DataFrame({"a": [1, 2]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df):
            df, sheet_names = load_preview_data("data.csv", "csv", 100)

        assert df is mock_df
        assert sheet_names is None

    def test_csv_with_source_config(self):
        mock_df = pd.DataFrame({"a": [1]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            df, _ = load_preview_data("data.csv", "csv", 100, source_config={"encoding": "gbk", "delimiter": ";"})

        assert df is mock_df
        # 验证 spec 包含 encoding 和 delimiter
        spec = mock_load.call_args[0][0]
        assert spec.encoding == "gbk"
        assert spec.delimiter == ";"

    def test_csv_default_encoding_and_delimiter(self):
        mock_df = pd.DataFrame({"a": [1]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            load_preview_data("data.csv", "csv", 100)

        spec = mock_load.call_args[0][0]
        assert spec.encoding == "utf-8"
        assert spec.delimiter == ","


class TestLoadPreviewDataJSON:
    def test_json_array_format(self):
        mock_df = pd.DataFrame({"a": [1, 2, 3]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            df, sheet_names = load_preview_data("data.json", "json", 100)

        assert df is mock_df
        assert sheet_names is None
        spec = mock_load.call_args[0][0]
        assert spec.format == "array"

    def test_json_lines_format_for_jsonl_extension(self):
        mock_df = pd.DataFrame({"a": [1]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            load_preview_data("data.jsonl", "json", 100)

        spec = mock_load.call_args[0][0]
        assert spec.format == "lines"

    def test_json_lines_format_for_ndjson_extension(self):
        mock_df = pd.DataFrame({"a": [1]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            load_preview_data("data.ndjson", "json", 100)

        spec = mock_load.call_args[0][0]
        assert spec.format == "lines"

    def test_json_truncates_to_max_rows(self):
        mock_df = pd.DataFrame({"a": list(range(200))})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df):
            df, _ = load_preview_data("data.json", "json", 50)

        assert len(df) == 50

    def test_json_no_truncation_when_under_max_rows(self):
        mock_df = pd.DataFrame({"a": [1, 2, 3]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df):
            df, _ = load_preview_data("data.json", "json", 100)

        assert len(df) == 3

    def test_json_with_json_path_config(self):
        mock_df = pd.DataFrame({"a": [1]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            load_preview_data("data.json", "json", 100, source_config={"json_path": "$.records"})

        spec = mock_load.call_args[0][0]
        assert spec.json_path == "$.records"

    def test_json_custom_format_from_source_config(self):
        mock_df = pd.DataFrame({"a": [1]})

        with patch("app.shared.services.preview.loader.load_source_data", return_value=mock_df) as mock_load:
            load_preview_data("data.json", "json", 100, source_config={"json_format": "object", "json_path": "$.data"})

        spec = mock_load.call_args[0][0]
        assert spec.format == "object"
        assert spec.json_path == "$.data"


class TestLoadPreviewDataUnsupported:
    def test_unsupported_file_type_raises_value_error(self):
        with pytest.raises(ValueError, match="不支持的文件类型"):
            load_preview_data("data.parquet", "parquet", 100)

    def test_empty_file_type_raises_value_error(self):
        with pytest.raises(ValueError, match="不支持的文件类型"):
            load_preview_data("data.txt", "", 100)
