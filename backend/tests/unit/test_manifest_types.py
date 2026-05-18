"""
@fileoverview Manifest 类型单元测试

覆盖 _coerce_none_to_list、_validate_unique_ids 的未覆盖分支。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.project.manifest.types_parts.manifest import ProjectManifest


class TestManifestTypes:
    def test_none_coerced_to_list(self):
        m = ProjectManifest(
            version=2,
            project={"id": "test", "name": "Test"},
            schemas=None,
            constraints=None,
            regex_nodes=None,
            data_sources=None,
        )
        assert m.schemas == []
        assert m.constraints == []
        assert m.regex_nodes == []
        assert m.data_sources == []

    def test_duplicate_schema_id(self):
        m = ProjectManifest(
            version=2,
            project={"id": "test", "name": "Test"},
            schemas=[
                {"id": "users", "path": "a.yaml"},
                {"id": "users", "path": "b.yaml"},
            ],
        )
        assert len(m.schemas) == 1
        assert len(m.warnings) == 1
        assert "重复" in m.warnings[0]

    def test_duplicate_constraint_id(self):
        m = ProjectManifest(
            version=2,
            project={"id": "test", "name": "Test"},
            constraints=[
                {"id": "uq", "path": "a.yaml"},
                {"id": "uq", "path": "b.yaml"},
            ],
        )
        assert len(m.constraints) == 1
        assert any("Constraint ID" in w for w in m.warnings)

    def test_duplicate_regex_id(self):
        m = ProjectManifest(
            version=2,
            project={"id": "test", "name": "Test"},
            regex_nodes=[
                {"id": "email", "path": "a.yaml"},
                {"id": "email", "path": "b.yaml"},
            ],
        )
        assert len(m.regex_nodes) == 1
        assert any("Regex ID" in w for w in m.warnings)

    def test_duplicate_data_source_id(self):
        m = ProjectManifest(
            version=2,
            project={"id": "test", "name": "Test"},
            data_sources=[
                {"id": "ds1", "path": "a"},
                {"id": "ds1", "path": "b"},
            ],
        )
        assert len(m.data_sources) == 1
        assert any("DataSource ID" in w for w in m.warnings)
