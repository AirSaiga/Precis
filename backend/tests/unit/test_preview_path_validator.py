"""测试预览路径验证模块"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.shared.services.preview.path.validator import validate_file_access, validate_file_path


class TestValidateFilePath:
    def test_empty_string(self):
        valid, error = validate_file_path("")
        assert valid is False
        assert "不能为空" in error

    def test_whitespace_only(self):
        valid, error = validate_file_path("   ")
        assert valid is False
        assert "不能为空" in error

    def test_path_too_long(self):
        valid, error = validate_file_path("a" * 501)
        assert valid is False
        assert "过长" in error

    def test_path_traversal(self):
        valid, error = validate_file_path("/etc/../etc/passwd")
        assert valid is False
        assert ".." in error

    def test_pseudo_absolute_path(self):
        valid, error = validate_file_path("/not/abs")
        assert valid is False
        assert "无效" in error

    def test_illegal_characters(self):
        for char in ["\0", "\n", "<", ">", "|", "*", "?", '"']:
            valid, error = validate_file_path(f"C:\\tmp\\test{char}file")
            assert valid is False, f"字符 {repr(char)} 应被拦截"
            assert "非法字符" in error

    def test_directory_path(self, tmp_path):
        valid, error = validate_file_path(str(tmp_path))
        assert valid is False
        assert "目录" in error

    def test_valid_nonexistent_file(self):
        valid, error = validate_file_path("C:\\tmp\\nonexistent_file_12345.csv")
        assert valid is True
        assert error == ""

    def test_valid_existing_file(self, tmp_path):
        f = tmp_path / "test.csv"
        f.write_text("a,b\n1,2")
        valid, error = validate_file_path(str(f))
        assert valid is True
        assert error == ""


class TestValidateFileAccess:
    def test_valid_path(self, tmp_path, monkeypatch):
        f = tmp_path / "test.csv"
        f.write_text("data")
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.is_path_in_allowed_directories",
            lambda path, must_exist=True: True,
        )
        validate_file_access(str(f))

    def test_invalid_path_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access("")
        assert exc_info.value.status_code == 400

    def test_path_not_in_whitelist_raises_403(self, monkeypatch):
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.is_path_in_allowed_directories",
            lambda path, must_exist=True: False,
        )
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access("C:\\tmp\\test.csv")
        assert exc_info.value.status_code == 403

    def test_nonexistent_file_raises_404(self, monkeypatch):
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.is_path_in_allowed_directories",
            lambda path, must_exist=True: True,
        )
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access("C:\\tmp\\nonexistent_12345.csv")
        assert exc_info.value.status_code == 404
