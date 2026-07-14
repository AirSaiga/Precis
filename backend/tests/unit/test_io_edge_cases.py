"""
@fileoverview IO/Reader 模块异常处理单元测试

覆盖 constraint/reader、manifest/reader、path_validation 的未覆盖分支。
"""

from pathlib import Path

import pytest
import yaml

from app.shared.core.project.constraint.reader import load_constraint
from app.shared.core.project.loader.loader_parts.path_validation import validate_path_inside_project
from app.shared.core.project.manifest.reader import load_manifest


class TestLoadConstraint:
    def test_invalid_yaml(self, tmp_path):
        bad_file = tmp_path / "bad.constraint.yaml"
        bad_file.write_text("not: valid: yaml: [", encoding="utf-8")
        # read_yaml raises ScannerError directly, not wrapped in ValueError
        with pytest.raises(yaml.scanner.ScannerError):
            load_constraint(str(bad_file))


class TestLoadManifest:
    def test_invalid_yaml(self, tmp_path):
        bad_file = tmp_path / "bad.precis.yaml"
        bad_file.write_text("not: valid: yaml: [", encoding="utf-8")
        with pytest.raises(yaml.scanner.ScannerError):
            load_manifest(str(bad_file))


class TestPathValidation:
    def test_path_outside_project(self):
        with pytest.raises(ValueError) as exc_info:
            validate_path_inside_project(Path("/project"), Path("/other/file.txt"))
        assert "超出项目根目录范围" in str(exc_info.value)

    def test_path_is_project_root(self):
        # Should not raise when path equals project root
        validate_path_inside_project(Path("/project"), Path("/project"))
