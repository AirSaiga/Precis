"""
@fileoverview CSV/Excel 加载器边缘分支单元测试

覆盖 CSVLoader 编码失败、异常分支、escapechar，
ExcelLoader sheet_index、大文件警告、preview 异常回退等。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import patch

import pandas as pd
import pytest

from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.csv_loader import CSVLoader
from app.shared.core.data_source.loaders.excel_loader import ExcelLoader
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec


def _make_csv_spec(real_path: str, **overrides):
    spec = CSVSourceSpec(path="test.csv", mode="relative", **overrides)
    spec.path = real_path
    return spec


def _make_excel_spec(real_path: str, **overrides):
    spec = ExcelSourceSpec(path="test.xlsx", mode="relative", **overrides)
    spec.path = real_path
    return spec


class TestCSVLoaderEdgeCases:
    def test_resolve_encoding_all_fail(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_bytes(b"\xff\xfe\x80\x81")
        spec = _make_csv_spec(str(csv_file), encoding="utf-8", fallback_encodings=["ascii"], encoding_detection=True)
        loader = CSVLoader(spec)
        with pytest.raises(UnicodeDecodeError):
            loader._resolve_encoding()

    def test_load_unicode_decode_error(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_bytes(b"\xff\xfe\x80\x81")
        # encoding_detection=False 让 _resolve_encoding 直接返回 utf-8，
        # 随后 pd.read_csv 抛出 UnicodeDecodeError，被 load() 捕获并包装为 DataLoadError
        spec = _make_csv_spec(str(csv_file), encoding="utf-8", encoding_detection=False)
        loader = CSVLoader(spec)
        with pytest.raises(DataLoadError) as exc_info:
            loader.load()
        assert "编码错误" in str(exc_info.value)

    def test_load_general_exception(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file))
        loader = CSVLoader(spec)
        with patch("pandas.read_csv", side_effect=RuntimeError("boom")):
            with pytest.raises(DataLoadError) as exc_info:
                loader.load()
        assert "CSV 加载失败" in str(exc_info.value)

    def test_load_with_escapechar(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text('a,b\n1,"2\\,3"\n', encoding="utf-8")
        spec = _make_csv_spec(str(csv_file), escapechar="\\")
        loader = CSVLoader(spec)
        df = loader.load()
        assert len(df) == 1


class TestExcelLoaderEdgeCases:
    def test_load_sheet_index(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        with pd.ExcelWriter(xlsx_file) as writer:
            pd.DataFrame({"x": [1]}).to_excel(writer, sheet_name="Sheet1", index=False)
            pd.DataFrame({"y": [2]}).to_excel(writer, sheet_name="Sheet2", index=False)
        spec = _make_excel_spec(str(xlsx_file), sheet=None, sheet_index=1)
        loader = ExcelLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["y"]

    def test_load_skip_rows(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": [1, 2, 3]}).to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file), skip_rows=1)
        loader = ExcelLoader(spec)
        df = loader.load()
        assert len(df) == 2

    def test_load_nrows(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": list(range(10))}).to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file), nrows=3)
        loader = ExcelLoader(spec)
        df = loader.load()
        assert len(df) == 3

    def test_load_general_exception(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": [1]}).to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file))
        loader = ExcelLoader(spec)
        with patch("pandas.read_excel", side_effect=RuntimeError("boom")):
            with pytest.raises(DataLoadError) as exc_info:
                loader.load()
        assert "Excel 加载失败" in str(exc_info.value)

    def test_validate_large_file(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": [1]}).to_excel(xlsx_file, index=False)
        # 模拟大文件：直接 patch stat().st_size
        spec = _make_excel_spec(str(xlsx_file))
        loader = ExcelLoader(spec)
        with patch("pathlib.Path.stat", return_value=type("S", (), {"st_size": 200 * 1024 * 1024})()):
            errors = loader.validate()
        assert any("较大" in e for e in errors)

    def test_preview_fallback(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": list(range(20))}).to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file))
        loader = ExcelLoader(spec)
        with patch("pandas.read_excel", side_effect=RuntimeError("preview boom")):
            # fallback 调用 super().preview，而 super().preview 又调用 load() 并截断，
            # 所以这里需要让 super().preview 的 load 也失败，或者接受它最终也抛异常
            with pytest.raises(DataLoadError):
                loader.preview(nrows=5)
