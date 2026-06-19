"""
@fileoverview 预览服务行为测试

覆盖 detect_file_type、df_to_list、cleanup_temp_file、preview_from_path。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api.services.preview_service import (
    cleanup_temp_file,
    detect_file_type,
    df_to_list,
    preview_from_path,
)


class TestPreviewService:
    """预览服务行为"""

    def test_detect_csv(self):
        assert detect_file_type(".csv") == "csv"

    def test_detect_excel(self):
        assert detect_file_type(".xlsx") == "excel"
        assert detect_file_type(".xls") == "excel"

    def test_detect_unsupported_raises(self):
        with pytest.raises(HTTPException) as exc_info:
            detect_file_type(".txt")
        assert exc_info.value.status_code == 400

    def test_df_to_list(self):
        import pandas as pd

        df = pd.DataFrame({"a": [1, 2], "b": ["x", "y"]})
        result = df_to_list(df, max_cols=10)
        assert len(result) == 2
        assert result[0] == ["1", "x"]

    def test_cleanup_missing_file(self, tmp_path):
        # 不应抛出异常
        cleanup_temp_file(str(tmp_path / "nonexistent.csv"))

    def test_preview_from_path_not_found(self):
        with pytest.raises(HTTPException) as exc_info:
            preview_from_path("/nonexistent/file_12345.csv", 100, 50)
        assert exc_info.value.status_code == 404
