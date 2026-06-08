"""
@fileoverview 预览数据处理服务模块单元测试

测试 detect_file_type、df_to_list、cleanup_temp_file、preview_from_path、preview_from_content。
"""

from __future__ import annotations

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pandas as pd
import pytest
from fastapi import HTTPException

from app.api.services.preview_service import (
    cleanup_temp_file,
    detect_file_type,
    df_to_list,
    preview_from_content,
    preview_from_path,
)


class TestDetectFileType:
    """detect_file_type 单元测试。"""

    def test_xlsx_returns_excel(self):
        assert detect_file_type(".xlsx") == "excel"

    def test_xls_returns_excel(self):
        assert detect_file_type(".xls") == "excel"

    def test_csv_returns_csv(self):
        assert detect_file_type(".csv") == "csv"

    def test_unsupported_extension_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            detect_file_type(".json")
        assert exc_info.value.status_code == 400
        assert ".json" in exc_info.value.detail

    def test_empty_extension_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            detect_file_type("")
        assert exc_info.value.status_code == 400


class TestDfToList:
    """df_to_list 单元测试。"""

    def test_empty_dataframe_returns_empty_list(self):
        df = pd.DataFrame()
        result = df_to_list(df, max_cols=5)
        assert result == []

    def test_basic_conversion(self):
        df = pd.DataFrame({"a": [1, 2], "b": ["x", "y"]})
        result = df_to_list(df, max_cols=10)
        assert result == [["1", "x"], ["2", "y"]]

    def test_truncates_to_max_cols(self):
        df = pd.DataFrame({f"col{i}": [i] for i in range(10)})
        result = df_to_list(df, max_cols=3)
        assert len(result) == 1
        assert len(result[0]) == 3
        assert result[0] == ["0", "1", "2"]

    def test_cells_converted_to_string(self):
        df = pd.DataFrame({"num": [1, 2.5], "mixed": [True, None]})
        result = df_to_list(df, max_cols=5)
        # 整数列在混合 DataFrame 中会被上转为 float，str() 后是 "1.0"
        assert len(result) == 2
        assert result[0][1] == "True"
        assert result[1][1] == "None"
        # 数值列被转字符串
        assert isinstance(result[0][0], str)
        assert isinstance(result[1][0], str)


class TestCleanupTempFile:
    """cleanup_temp_file 单元测试。"""

    def test_nonexistent_file_skipped(self, tmp_path):
        # 不存在的文件不应抛出异常
        cleanup_temp_file(str(tmp_path / "ghost.tmp"))
        assert not (tmp_path / "ghost.tmp").exists()

    def test_existing_file_deleted(self, tmp_path):
        target = tmp_path / "to_delete.tmp"
        target.write_text("data")
        assert target.exists()
        cleanup_temp_file(str(target))
        assert not target.exists()

    def test_permission_error_retries(self, tmp_path, monkeypatch):
        target = tmp_path / "perm.tmp"
        target.write_text("data")

        call_count = {"n": 0}

        real_unlink = os.unlink

        def flaky_unlink(path):
            call_count["n"] += 1
            if call_count["n"] <= 2:
                raise PermissionError("locked")
            real_unlink(path)

        monkeypatch.setattr("os.unlink", flaky_unlink)

        # 不应抛出异常——会在重试中成功
        cleanup_temp_file(str(target))

        assert call_count["n"] == 3

    def test_unexpected_exception_breaks_loop(self, tmp_path, monkeypatch):
        target = tmp_path / "weird.tmp"
        target.write_text("data")

        def weird_unlink(path):
            raise OSError("disk gone")

        monkeypatch.setattr("os.unlink", weird_unlink)

        # 不应抛出——遇到非 PermissionError 就 break
        cleanup_temp_file(str(target))

        assert target.exists()


class TestPreviewFromPath:
    """preview_from_path 单元测试。"""

    def test_nonexistent_file_raises_404(self):
        with pytest.raises(HTTPException) as exc_info:
            preview_from_path(
                file_path="/no/such/file.csv",
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 404

    def test_unsupported_extension_raises_400(self, tmp_path):
        f = tmp_path / "data.json"
        f.write_text("{}")
        with pytest.raises(HTTPException) as exc_info:
            preview_from_path(
                file_path=str(f),
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 400

    def test_csv_success(self, tmp_path, monkeypatch):
        f = tmp_path / "users.csv"
        f.write_text("id,name\n1,alice\n2,bob\n", encoding="utf-8")

        sample_df = pd.DataFrame({"id": ["1", "2"], "name": ["alice", "bob"]})

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            return sample_df, None

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        data, ftype, total, sheets, cur_sheet = preview_from_path(
            file_path=str(f),
            max_rows=10,
            max_cols=10,
        )
        assert ftype == "csv"
        assert total == 2
        assert sheets is None
        assert cur_sheet is None
        assert data == [["1", "alice"], ["2", "bob"]]

    def test_excel_success_default_sheet(self, tmp_path, monkeypatch):
        f = tmp_path / "data.xlsx"
        # 创建一个空的合法 xlsx 文件供 pd.ExcelFile 读取
        from openpyxl import Workbook

        wb = Workbook()
        wb.save(str(f))

        # 模拟 pd.ExcelFile（preview_from_path 内部调用）
        class FakeExcelFile:
            def __init__(self, path, engine=None):
                self.sheet_names = ["Sheet1", "Sheet2"]

            def close(self):
                pass

        monkeypatch.setattr("pandas.ExcelFile", FakeExcelFile)

        sample_df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            return sample_df, ["Sheet1", "Sheet2"]

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        data, ftype, total, sheets, cur_sheet = preview_from_path(
            file_path=str(f),
            max_rows=10,
            max_cols=10,
        )
        assert ftype == "excel"
        assert total == 2
        assert sheets == ["Sheet1", "Sheet2"]
        assert cur_sheet == "Sheet1"
        assert data == [["1", "3"], ["2", "4"]]

    def test_excel_with_specific_sheet(self, tmp_path, monkeypatch):
        f = tmp_path / "data.xlsx"
        f.write_bytes(b"")  # 占位；不会真正打开

        sample_df = pd.DataFrame({"x": [10]})

        captured = {}

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            captured["sheet_name"] = sheet_name
            return sample_df, ["Sheet1", "Sheet2"]

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        data, ftype, total, sheets, cur_sheet = preview_from_path(
            file_path=str(f),
            max_rows=10,
            max_cols=10,
            sheet_name="Sheet2",
        )
        assert ftype == "excel"
        assert cur_sheet == "Sheet2"
        assert captured["sheet_name"] == "Sheet2"

    def test_excel_missing_sheet_raises_404(self, tmp_path, monkeypatch):
        f = tmp_path / "data.xlsx"
        f.write_bytes(b"")

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            raise ValueError("Worksheet 'Ghost' not found")

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        with pytest.raises(HTTPException) as exc_info:
            preview_from_path(
                file_path=str(f),
                max_rows=10,
                max_cols=10,
                sheet_name="Ghost",
            )
        assert exc_info.value.status_code == 404
        assert "Ghost" in exc_info.value.detail

    def test_excel_other_value_error_raises_500(self, tmp_path, monkeypatch):
        f = tmp_path / "data.xlsx"
        f.write_bytes(b"")

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            raise ValueError("bad data")

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        with pytest.raises(HTTPException) as exc_info:
            preview_from_path(
                file_path=str(f),
                max_rows=10,
                max_cols=10,
                sheet_name="Sheet1",
            )
        assert exc_info.value.status_code == 500

    def test_excel_generic_error_raises_500(self, tmp_path, monkeypatch):
        f = tmp_path / "data.xlsx"
        f.write_bytes(b"")

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            raise RuntimeError("corrupt")

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        with pytest.raises(HTTPException) as exc_info:
            preview_from_path(
                file_path=str(f),
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 500

    def test_csv_generic_error_raises_500(self, tmp_path, monkeypatch):
        f = tmp_path / "data.csv"
        f.write_text("a,b\n1,2\n", encoding="utf-8")

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            raise RuntimeError("decode failed")

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        with pytest.raises(HTTPException) as exc_info:
            preview_from_path(
                file_path=str(f),
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 500

    def test_excel_truncates_to_max_cols(self, tmp_path, monkeypatch):
        f = tmp_path / "wide.xlsx"
        f.write_bytes(b"")

        sample_df = pd.DataFrame({f"c{i}": [i] for i in range(10)})

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            return sample_df, ["Sheet1"]

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        # 默认 sheet 时会调用 pd.ExcelFile，必须 mock
        class FakeExcelFile:
            def __init__(self, path, engine=None):
                self.sheet_names = ["Sheet1"]

            def close(self):
                pass

        monkeypatch.setattr("pandas.ExcelFile", FakeExcelFile)

        data, _ftype, _total, _sheets, _cur = preview_from_path(
            file_path=str(f),
            max_rows=10,
            max_cols=2,
        )
        assert len(data[0]) == 2


class TestPreviewFromContent:
    """preview_from_content 单元测试。"""

    def test_empty_content_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            preview_from_content(
                content=b"",
                file_ext=".csv",
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 400

    def test_unsupported_extension_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            preview_from_content(
                content=b"data",
                file_ext=".pdf",
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 400

    def test_csv_success(self, tmp_path, monkeypatch):
        # 拦截 tempfile.NamedTemporaryFile，让它把内容写到 tmp_path 中
        sample_df = pd.DataFrame({"a": ["1"], "b": ["2"]})
        captured = {}

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            captured["file_path"] = file_path
            captured["file_type"] = file_type
            return sample_df, None

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        # mock tempfile 让 cleanup 能找到这个文件
        fake_tmp = tmp_path / "upload.csv"
        fake_tmp.write_text("a,b\n1,2\n", encoding="utf-8")

        import tempfile as _tempfile

        class FakeNamedTemporaryFile:
            def __init__(self, suffix=None, delete=False):
                self._path = str(fake_tmp)
                self.name = self._path

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def write(self, data):
                # 不真正写入，文件已存在
                pass

        monkeypatch.setattr(_tempfile, "NamedTemporaryFile", FakeNamedTemporaryFile)

        data, ftype, total, sheets, cur_sheet = preview_from_content(
            content=b"a,b\n1,2\n",
            file_ext=".csv",
            max_rows=10,
            max_cols=10,
        )
        assert ftype == "csv"
        assert total == 1
        assert data == [["1", "2"]]
        assert captured["file_type"] == "csv"
        # 临时文件应在 finally 中被清理
        assert not fake_tmp.exists()

    def test_excel_success(self, tmp_path, monkeypatch):
        sample_df = pd.DataFrame({"x": ["10"], "y": ["20"]})

        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            return sample_df, ["S1", "S2"]

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        fake_tmp = tmp_path / "upload.xlsx"
        fake_tmp.write_bytes(b"x")

        class FakeExcelFile:
            def __init__(self, path, engine=None):
                self.sheet_names = ["S1", "S2"]

            def close(self):
                pass

        monkeypatch.setattr("pandas.ExcelFile", FakeExcelFile)

        import tempfile as _tempfile

        class FakeNamedTemporaryFile:
            def __init__(self, suffix=None, delete=False):
                self.name = str(fake_tmp)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def write(self, data):
                pass

        monkeypatch.setattr(_tempfile, "NamedTemporaryFile", FakeNamedTemporaryFile)

        data, ftype, total, sheets, cur_sheet = preview_from_content(
            content=b"x",
            file_ext=".xlsx",
            max_rows=10,
            max_cols=10,
        )
        assert ftype == "excel"
        assert total == 1
        assert sheets == ["S1", "S2"]
        assert cur_sheet == "S1"
        assert data == [["10", "20"]]
        # Excel 分支的 finally 触发 gc.collect 并 cleanup
        assert not fake_tmp.exists()

    def test_excel_error_raises_500_and_cleans_up(self, tmp_path, monkeypatch):
        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            raise RuntimeError("xlsx broken")

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        fake_tmp = tmp_path / "upload.xlsx"
        fake_tmp.write_bytes(b"x")

        class FakeExcelFile:
            def __init__(self, path, engine=None):
                self.sheet_names = ["S1"]

            def close(self):
                pass

        monkeypatch.setattr("pandas.ExcelFile", FakeExcelFile)

        import tempfile as _tempfile

        class FakeNamedTemporaryFile:
            def __init__(self, suffix=None, delete=False):
                self.name = str(fake_tmp)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def write(self, data):
                pass

        monkeypatch.setattr(_tempfile, "NamedTemporaryFile", FakeNamedTemporaryFile)

        with pytest.raises(HTTPException) as exc_info:
            preview_from_content(
                content=b"x",
                file_ext=".xlsx",
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 500
        # 异常后临时文件仍应被清理
        assert not fake_tmp.exists()

    def test_csv_error_raises_500_and_cleans_up(self, tmp_path, monkeypatch):
        def fake_load(file_path, file_type, max_rows, sheet_name=None, source_config=None):
            raise RuntimeError("csv broken")

        monkeypatch.setattr(
            "app.api.services.preview_service.load_preview_data",
            fake_load,
        )

        fake_tmp = tmp_path / "upload.csv"
        fake_tmp.write_text("a,b\n1,2\n", encoding="utf-8")

        import tempfile as _tempfile

        class FakeNamedTemporaryFile:
            def __init__(self, suffix=None, delete=False):
                self.name = str(fake_tmp)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def write(self, data):
                pass

        monkeypatch.setattr(_tempfile, "NamedTemporaryFile", FakeNamedTemporaryFile)

        with pytest.raises(HTTPException) as exc_info:
            preview_from_content(
                content=b"a,b\n1,2\n",
                file_ext=".csv",
                max_rows=10,
                max_cols=10,
            )
        assert exc_info.value.status_code == 500
        assert not fake_tmp.exists()
