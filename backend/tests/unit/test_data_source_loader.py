# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""
@fileoverview 数据源加载器模块单元测试

测试 loader.py 中的 can_load 和 load_grouped_sources。
"""

from unittest.mock import MagicMock, patch

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
        assert can_load("data.tsv") is True
        assert can_load("data.ndjson") is True

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

    @patch("app.shared.core.data_source.loader.CSVLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_csv_source_config_overrides_manifest_defaults(self, mock_exists, mock_csv_loader_cls):
        """回归: schema 的 source_config 中的 CSV 读取参数必须生效，manifest 默认值仅作兜底。

        过去 source_config 被丢弃，分号分隔/GBK 编码/跳行等配置静默失效导致解析错位。
        """
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load.return_value = pd.DataFrame({"col": [1]})
        mock_csv_loader_cls.return_value = mock_loader

        info = DataSourceInfo(
            schema_id="orders",
            name="orders",
            header_row=1,
            source_config={
                "delimiter": "\t",
                "encoding": "gbk",
                "skip_rows": 2,
                "quotechar": "'",
                "on_bad_lines": "skip",
            },
        )
        datasets, errors = load_grouped_sources(
            {"data.csv": [info]},
            default_encoding="utf-8",
            csv_delimiter=",",
        )

        assert len(errors) == 0
        assert "orders" in datasets
        spec = mock_csv_loader_cls.call_args.args[0]
        assert spec.delimiter == "\t"
        assert spec.encoding == "gbk"
        assert spec.skip_rows == 2
        assert spec.quotechar == "'"
        assert spec.on_bad_lines == "skip"

    @patch("app.shared.core.data_source.loader.CSVLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_csv_source_config_missing_keys_fall_back_to_manifest_defaults(self, mock_exists, mock_csv_loader_cls):
        """source_config 未提供键时应回退到 manifest 级默认值。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load.return_value = pd.DataFrame({"col": [1]})
        mock_csv_loader_cls.return_value = mock_loader

        info = DataSourceInfo(schema_id="orders", name="orders", header_row=0, source_config={})
        datasets, errors = load_grouped_sources(
            {"data.csv": [info]},
            default_encoding="gbk",
            csv_delimiter=";",
        )

        assert len(errors) == 0
        spec = mock_csv_loader_cls.call_args.args[0]
        assert spec.encoding == "gbk"
        assert spec.delimiter == ";"

    @patch("app.shared.core.data_source.loader.CSVLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_tsv_default_delimiter_is_tab(self, mock_exists, mock_csv_loader_cls):
        """G4：.tsv 无显式 delimiter 时缺省制表符（manifest 级通用逗号不适用）。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load.return_value = pd.DataFrame({"col": [1]})
        mock_csv_loader_cls.return_value = mock_loader

        info = DataSourceInfo(schema_id="users", name="users", header_row=0, source_config={})
        datasets, errors = load_grouped_sources(
            {"data.tsv": [info]},
            default_encoding="utf-8",
            csv_delimiter=",",
        )

        assert len(errors) == 0
        assert "users" in datasets
        spec = mock_csv_loader_cls.call_args.args[0]
        assert spec.delimiter == "\t"

    @patch("app.shared.core.data_source.loader.CSVLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_tsv_source_config_delimiter_wins(self, mock_exists, mock_csv_loader_cls):
        """G4：.tsv 的 source_config 显式 delimiter 覆盖扩展名缺省。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load.return_value = pd.DataFrame({"col": [1]})
        mock_csv_loader_cls.return_value = mock_loader

        info = DataSourceInfo(schema_id="users", name="users", header_row=0, source_config={"delimiter": ";"})
        datasets, errors = load_grouped_sources({"data.tsv": [info]})

        assert len(errors) == 0
        spec = mock_csv_loader_cls.call_args.args[0]
        assert spec.delimiter == ";"

    def test_tsv_and_ndjson_end_to_end(self, tmp_path):
        """G4：.tsv/.ndjson 真实文件经核心注册表加载成功（validate_table 链路）。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        tsv = tmp_path / "users.tsv"
        tsv.write_text("id\tname\n1\talice\n2\tbob\n", encoding="utf-8")
        ndjson = tmp_path / "events.ndjson"
        ndjson.write_text('{"id": 1}\n{"id": 2}\n', encoding="utf-8")

        datasets, errors = load_grouped_sources(
            {
                str(tsv): [DataSourceInfo(schema_id="users", name="users", header_row=0)],
                str(ndjson): [DataSourceInfo(schema_id="events", name="events", header_row=0)],
            }
        )

        assert errors == []
        assert list(datasets["users"].columns) == ["id", "name"]
        assert datasets["users"].iloc[1]["name"] == "bob"
        assert len(datasets["events"]) == 2

    @patch("app.shared.core.data_source.loader.ExcelLoader")
    @patch("app.shared.core.data_source.loader.os.path.exists")
    def test_excel_engine_from_source_config(self, mock_exists, mock_excel_loader_cls):
        """回归: Excel 的 engine 读取参数应从 source_config 透传到 spec。"""
        from app.shared.core.data_source.loader import DataSourceInfo

        mock_exists.return_value = True
        mock_loader = MagicMock()
        mock_loader.load_multi_sheet.return_value = {"users": pd.DataFrame({"col": [1]})}
        mock_excel_loader_cls.return_value = mock_loader

        info = DataSourceInfo(
            schema_id="users", name="users", sheet_name="Sheet1", header_row=0, source_config={"engine": "xlrd"}
        )
        datasets, errors = load_grouped_sources({"data.xls": [info]})

        assert len(errors) == 0
        spec = mock_excel_loader_cls.call_args.args[0]
        assert spec.engine == "xlrd"

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
