"""
@fileoverview 数据源加载器模块单元测试

测试 loader.py 中的 can_load 和 load_grouped_sources。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)


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
