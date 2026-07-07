"""
@fileoverview CSV/Excel 加载器单元测试

测试 CSVLoader 和 ExcelLoader 的 load/validate/preview 方法。
通过先构造合法相对路径再覆盖 path 属性绕过 Windows 绝对路径校验。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


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


class TestCSVLoader:
    def test_load_basic(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b\n1,2\n3,4\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file))
        loader = CSVLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["a", "b"]
        assert len(df) == 2

    def test_load_no_header(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("1,2\n3,4\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file), header_enabled=False)
        loader = CSVLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["col_0", "col_1"]

    def test_load_skip_rows(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("skip\na,b\n1,2\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file), skip_rows=1)
        loader = CSVLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["a", "b"]
        assert len(df) == 1

    def test_load_nrows(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b\n1,2\n3,4\n5,6\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file), nrows=2)
        loader = CSVLoader(spec)
        df = loader.load()
        assert len(df) == 2

    def test_load_file_not_found(self):
        spec = _make_csv_spec("D:\\nonexistent.csv")
        loader = CSVLoader(spec)
        with pytest.raises(DataLoadError):
            loader.load()

    def test_resolve_encoding_no_detection(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a\n1\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file), encoding_detection=False)
        loader = CSVLoader(spec)
        assert loader._resolve_encoding() == "utf-8"

    def test_resolve_encoding_with_detection(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a\n1\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file), encoding_detection=True)
        loader = CSVLoader(spec)
        assert loader._resolve_encoding() == "utf-8"

    def test_validate_exists(self, tmp_path):
        csv_file = tmp_path / "test.csv"
        csv_file.write_text("a,b\n1,2\n", encoding="utf-8")
        spec = _make_csv_spec(str(csv_file))
        loader = CSVLoader(spec)
        errors = loader.validate()
        assert errors == []

    def test_validate_not_exists(self):
        spec = _make_csv_spec("D:\\nonexistent.csv")
        loader = CSVLoader(spec)
        errors = loader.validate()
        assert any("不存在" in e for e in errors)

    def test_validate_wrong_extension(self, tmp_path):
        """B19 回归：扩展名不符只是警告（记录日志），不再作为错误返回。
        过去 warning 被加入 errors 列表，调用方按 errors 非空判定为加载失败。"""
        txt_file = tmp_path / "test.txt"
        txt_file.write_text("a,b\n1,2\n", encoding="utf-8")
        spec = _make_csv_spec(str(txt_file))
        loader = CSVLoader(spec)
        errors = loader.validate()
        # 非 .csv 扩展名不应阻止加载，errors 应为空
        assert errors == []


class TestExcelLoader:
    def test_load_basic(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        df_orig = pd.DataFrame({"a": [1, 3], "b": [2, 4]})
        df_orig.to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file))
        loader = ExcelLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["a", "b"]
        assert len(df) == 2

    def test_load_sheet_name(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        with pd.ExcelWriter(xlsx_file) as writer:
            pd.DataFrame({"x": [1]}).to_excel(writer, sheet_name="Sheet1", index=False)
            pd.DataFrame({"y": [2]}).to_excel(writer, sheet_name="Sheet2", index=False)
        spec = _make_excel_spec(str(xlsx_file), sheet="Sheet2")
        loader = ExcelLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["y"]

    def test_load_no_header(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        df_orig = pd.DataFrame({0: [1, 3], 1: [2, 4]})
        df_orig.to_excel(xlsx_file, index=False, header=False)
        spec = _make_excel_spec(str(xlsx_file), header_enabled=False)
        loader = ExcelLoader(spec)
        df = loader.load()
        assert list(df.columns) == ["col_0", "col_1"]

    def test_load_file_not_found(self):
        spec = _make_excel_spec("D:\\nonexistent.xlsx")
        loader = ExcelLoader(spec)
        with pytest.raises(DataLoadError):
            loader.load()

    def test_validate_exists(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": [1]}).to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file))
        loader = ExcelLoader(spec)
        errors = loader.validate()
        assert errors == []

    def test_validate_not_exists(self):
        spec = _make_excel_spec("D:\\nonexistent.xlsx")
        loader = ExcelLoader(spec)
        errors = loader.validate()
        assert any("不存在" in e for e in errors)

    def test_validate_wrong_extension(self, tmp_path):
        txt_file = tmp_path / "test.txt"
        txt_file.write_text("hello", encoding="utf-8")
        spec = _make_excel_spec(str(txt_file))
        loader = ExcelLoader(spec)
        errors = loader.validate()
        assert any("不支持" in e for e in errors)

    def test_preview(self, tmp_path):
        xlsx_file = tmp_path / "test.xlsx"
        pd.DataFrame({"a": list(range(20))}).to_excel(xlsx_file, index=False)
        spec = _make_excel_spec(str(xlsx_file))
        loader = ExcelLoader(spec)
        df = loader.preview(nrows=5)
        assert len(df) == 5
