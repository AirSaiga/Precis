"""
@fileoverview Project Loader 类型单元测试

测试 LoadingError 和 LoadedProject 数据类。
"""

import os
import sys
from pathlib import Path

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.project.loader.types import LoadedProject, LoadingError


class TestLoadingError:
    def test_to_dict(self):
        err = LoadingError(
            error_type="SchemaNotFound",
            file_path="/path/to/schema.yaml",
            ref_id="users",
            message="文件不存在",
            suggestion="检查路径",
        )
        d = err.to_dict()
        assert d["error_type"] == "SchemaNotFound"
        assert d["file_path"] == "/path/to/schema.yaml"
        assert d["ref_id"] == "users"
        assert d["message"] == "文件不存在"
        assert d["suggestion"] == "检查路径"

    def test_defaults(self):
        err = LoadingError(error_type="ParseError", file_path="/x.yaml")
        assert err.ref_id is None
        assert err.message == ""
        assert err.suggestion == ""


class TestLoadedProject:
    def test_post_init_defaults(self):
        lp = LoadedProject(
            manifest_path=Path("/project/manifest.yaml"),
            manifest=None,
            schema_files={},
            constraint_files={},
            regex_node_files={},
            dataset_schema=None,
        )
        assert lp.warnings == []
        assert lp.loading_errors == []

    def test_post_init_preserves_values(self):
        lp = LoadedProject(
            manifest_path=Path("/project/manifest.yaml"),
            manifest=None,
            schema_files={},
            constraint_files={},
            regex_node_files={},
            dataset_schema=None,
            warnings=["warn1"],
            loading_errors=[LoadingError("E", "/f")],
        )
        assert lp.warnings == ["warn1"]
        assert len(lp.loading_errors) == 1
