"""
@fileoverview 数据源加载器模块单元测试

测试 loader.py 中的 can_load 和 load_grouped_sources。
"""

import os
import sys
from unittest.mock import MagicMock, patch

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd

from app.shared.core.data_source.loader import (
    can_load,
    load_grouped_sources,
)


class TestCanLoad:
    def test_supported_extensions(self):
        assert can_load("data.xlsx") is True
        assert can_load("data.xls") is True
        assert can_load("data.csv") is True
        assert can_load("data.json") is True
        assert can_load("data.jsonl") is True

    def test_unsupported_extension(self):
        assert can_load("data.txt") is False
        assert can_load("data") is False

    def test_case_insensitive(self):
        assert can_load("data.XLSX") is True
        assert can_load("data.CSV") is True


class TestLoadGroupedSources:
    def test_unsupported_file_type(self):
        datasets, errors = load_grouped_sources({"data.txt": []})
        assert len(errors) == 1
        assert errors[0]["error_type"] == "UnsupportedFileType"

    def test_file_not_found(self):
        datasets, errors = load_grouped_sources({"/nonexistent/data.csv": []})
        assert len(errors) == 1
        assert errors[0]["error_type"] == "FileNotFound"

    @patch("app.shared.core.data_source.loader.CSVLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_csv_params_passed_to_loader(self, mock_exists, mock_csv_loader_cls):
        """验证 default_encoding 与 csv_delimiter 会正确传入 CSVSourceSpec。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load.return_value = pd.DataFrame({"col": [1]})
        mock_csv_loader_cls.return_value = mock_loader

        info = DataSourceInfo(schema_id="orders", name="orders", header_row=0)
        datasets, errors = load_grouped_sources(
            {"data.csv": [info]},
            default_encoding="gbk",
            csv_delimiter=";",
        )

        assert len(errors) == 0
        assert "orders" in datasets
        mock_csv_loader_cls.assert_called_once()
        spec = mock_csv_loader_cls.call_args.args[0]
        assert spec.encoding == "gbk"
        assert spec.delimiter == ";"

    @patch("app.shared.core.data_source.loader.ExcelLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_excel_file_to_sheet_names_fallback(self, mock_exists, mock_excel_loader_cls):
        """验证 file_to_sheet_names 可在 schema 未指定 sheet_name 时作为回退。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load_multi_sheet.return_value = {"users": pd.DataFrame({"col": [1]})}
        mock_excel_loader_cls.return_value = mock_loader

        info = DataSourceInfo(schema_id="users", name="users", header_row=0)
        datasets, errors = load_grouped_sources(
            {"data.xlsx": [info]},
            file_to_sheet_names={"data.xlsx": "Sheet1"},
        )

        assert len(errors) == 0
        assert "users" in datasets
        mock_loader.load_multi_sheet.assert_called_once()
        sheet_configs = mock_loader.load_multi_sheet.call_args.args[0]
        assert sheet_configs["users"]["sheet_name"] == "Sheet1"
