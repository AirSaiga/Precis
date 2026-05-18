"""
@fileoverview data_source/loader.py 主入口单元测试

测试 can_load、load_grouped_sources 等当前公开的 API。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock, patch

import pandas as pd

from app.shared.core.data_source.loader import (
    can_load,
    load_grouped_sources,
)


class TestCanLoad:
    def test_csv(self):
        assert can_load("data.csv") is True
        assert can_load("data.CSV") is True

    def test_xlsx(self):
        assert can_load("data.xlsx") is True

    def test_json(self):
        assert can_load("data.json") is True

    def test_unsupported(self):
        assert can_load("data.txt") is False
        assert can_load("data") is False


class TestLoadGroupedSources:
    def test_unsupported_file_type(self):
        datasets, errors = load_grouped_sources({"file.txt": []})
        assert datasets == {}
        assert len(errors) == 1
        assert errors[0]["error_type"] == "UnsupportedFileType"

    def test_file_not_found(self):
        datasets, errors = load_grouped_sources({"D:\\nonexistent.csv": []})
        assert datasets == {}
        assert len(errors) == 1
        assert errors[0]["error_type"] == "FileNotFound"

    def test_success_with_mock_loader(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        mock_loader = MagicMock(return_value={"table1": pd.DataFrame({"a": [1]})})
        with patch.dict("app.shared.core.data_source.loader._LOADER_FNS", {".csv": mock_loader}, clear=False):
            datasets, errors = load_grouped_sources({str(csv_file): []})
        assert len(datasets) == 1
        assert "table1" in datasets
        assert errors == []
        mock_loader.assert_called_once()

    def test_loader_exception(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        mock_loader = MagicMock(side_effect=Exception("boom"))
        with patch.dict("app.shared.core.data_source.loader._LOADER_FNS", {".csv": mock_loader}, clear=False):
            datasets, errors = load_grouped_sources({str(csv_file): []})
        assert datasets == {}
        assert len(errors) == 1
        assert errors[0]["error_type"] == "LoadFailed"
        assert "boom" in errors[0]["message"]
