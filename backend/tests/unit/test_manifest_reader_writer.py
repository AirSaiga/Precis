"""
@fileoverview 项目清单读写模块单元测试

测试 load_manifest, save_manifest, ensure_schema_ref, ensure_constraint_ref, ensure_regex_ref。
"""

import os
import sys
import tempfile

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.shared.core.project.manifest.reader import load_manifest
from app.shared.core.project.manifest.types import ProjectManifest
from app.shared.core.project.manifest.writer import (
    ensure_constraint_ref,
    ensure_regex_ref,
    ensure_schema_ref,
    save_manifest,
)


class TestLoadManifest:
    def test_load_valid_manifest(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".precis.yaml", delete=False, encoding="utf-8") as f:
            f.write("""
version: 2
project:
  id: test-project
  name: Test Project
schemas:
  - id: users
    path: schemas/users.schema.yaml
""")
            path = f.name
        try:
            m = load_manifest(path)
            assert isinstance(m, ProjectManifest)
            assert m.project.id == "test-project"
            assert len(m.schemas) == 1
        finally:
            os.unlink(path)

    def test_load_missing_file_raises(self):
        with pytest.raises(ValueError, match="不存在"):
            load_manifest("/nonexistent/project.precis.yaml")


class TestSaveManifest:
    def test_save_and_load_roundtrip(self):
        manifest = ProjectManifest(
            version=2,
            project={"id": "roundtrip", "name": "Roundtrip"},
            schemas=[{"id": "orders", "path": "schemas/orders.schema.yaml"}],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "project.precis.yaml")
            save_manifest(manifest, path)
            loaded = load_manifest(path)
            assert loaded.project.id == "roundtrip"
            assert loaded.schemas[0].id == "orders"


class TestEnsureRefs:
    def test_ensure_schema_ref_existing(self):
        m = ProjectManifest(
            version=2, project={"id": "p", "name": "P"}, schemas=[{"id": "users", "path": "custom.yaml"}]
        )
        ref = ensure_schema_ref(m, "users")
        assert ref.path == "custom.yaml"
        assert len(m.schemas) == 1

    def test_ensure_schema_ref_new(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref = ensure_schema_ref(m, "orders")
        assert ref.path == "schemas/orders.schema.yaml"
        assert len(m.schemas) == 1

    def test_ensure_constraint_ref_existing(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"}, constraints=[{"id": "c1", "path": "c.yaml"}])
        ref = ensure_constraint_ref(m, "c1")
        assert ref.path == "c.yaml"

    def test_ensure_constraint_ref_new(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref = ensure_constraint_ref(m, "unique_email")
        assert ref.path == "constraints/unique_email.constraint.yaml"

    def test_ensure_regex_ref_existing(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"}, regex_nodes=[{"id": "r1", "path": "r.yaml"}])
        ref = ensure_regex_ref(m, "r1")
        assert ref.path == "r.yaml"

    def test_ensure_regex_ref_new(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref = ensure_regex_ref(m, "phone")
        assert ref.path == "regex/phone.regex.yaml"
