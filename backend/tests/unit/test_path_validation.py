"""path_validation 模块单元测试"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.shared.services.preview.path_validation import validate_file_access


class TestValidateFileAccess:
    def test_empty_path_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access("")
        assert exc_info.value.status_code == 400

    def test_whitespace_path_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access("   ")
        assert exc_info.value.status_code == 400

    def test_nonexistent_file_raises_404(self, tmp_path):
        missing = str(tmp_path / "nonexistent.csv")
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access(missing)
        assert exc_info.value.status_code == 404

    def test_existing_file_passes(self, tmp_path):
        f = tmp_path / "data.csv"
        f.write_text("a,b\n1,2", encoding="utf-8")
        validate_file_access(str(f))
