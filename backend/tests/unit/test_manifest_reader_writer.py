"""
@fileoverview 项目清单读写模块单元测试

测试 load_manifest, save_manifest, ensure_schema_ref, ensure_constraint_ref, ensure_regex_ref。
"""

import os
import tempfile

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


class TestEnsureRefsEdgeCases:
    """ensure_*_ref 边界场景测试。"""

    def test_ensure_schema_ref_default_path_overridden(self):
        # 提供 custom_path 时应覆盖默认路径
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref = ensure_schema_ref(m, "orders", default_path="custom/orders.yaml")
        assert ref.path == "custom/orders.yaml"
        assert ref.id == "orders"
        assert m.schemas[0].path == "custom/orders.yaml"

    def test_ensure_constraint_ref_default_path_overridden(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref = ensure_constraint_ref(m, "c1", default_path="custom/c1.yaml")
        assert ref.path == "custom/c1.yaml"

    def test_ensure_regex_ref_default_path_overridden(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref = ensure_regex_ref(m, "r1", default_path="custom/r1.yaml")
        assert ref.path == "custom/r1.yaml"

    def test_ensure_schema_ref_called_twice_does_not_duplicate(self):
        # 重复调用应返回同一引用，且不创建重复条目
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref1 = ensure_schema_ref(m, "users")
        ref2 = ensure_schema_ref(m, "users")
        assert ref1 is ref2
        assert len(m.schemas) == 1
        assert m.schemas[0] is ref1

    def test_ensure_constraint_ref_called_twice_does_not_duplicate(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref1 = ensure_constraint_ref(m, "c1")
        ref2 = ensure_constraint_ref(m, "c1")
        assert ref1 is ref2
        assert len(m.constraints) == 1

    def test_ensure_regex_ref_called_twice_does_not_duplicate(self):
        m = ProjectManifest(version=2, project={"id": "p", "name": "P"})
        ref1 = ensure_regex_ref(m, "r1")
        ref2 = ensure_regex_ref(m, "r1")
        assert ref1 is ref2
        assert len(m.regex_nodes) == 1

    def test_ensure_ref_works_when_field_is_none(self):
        # 显式传 None 时也应正常处理（model 端有 _coerce_none_to_list 兜底）
        m = ProjectManifest(
            version=2,
            project={"id": "p", "name": "P"},
            schemas=None,
            constraints=None,
            regex_nodes=None,
        )
        assert m.schemas == []
        ref = ensure_schema_ref(m, "users")
        assert ref.id == "users"
        assert len(m.schemas) == 1

    def test_ensure_ref_appends_to_existing_list(self):
        # 已存在一个引用时，新引用应追加（而非替换）到列表末尾
        m = ProjectManifest(
            version=2,
            project={"id": "p", "name": "P"},
            schemas=[{"id": "first", "path": "a.yaml"}],
        )
        ref = ensure_schema_ref(m, "second")
        assert len(m.schemas) == 2
        assert m.schemas[0].id == "first"
        assert m.schemas[1].id == "second"
        assert m.schemas[1] is ref


class TestSaveManifestEdgeCases:
    """save_manifest 边界场景测试。"""

    def test_save_manifest_excludes_none_fields(self):
        # exclude_none=True 在写盘时被使用，且空列表字段会被序列化为 []
        # （Pydantic 字段验证器将 None 转 []，因此实际场景下空列表出现在 YAML）
        m = ProjectManifest(
            version=2,
            project={"id": "p", "name": "P"},
            schemas=None,
            constraints=None,
            regex_nodes=None,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "project.precis.yaml")
            save_manifest(m, path)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            # project 必出现
            assert "project" in content
            # None 经过模型验证器转 []，因此空列表以 [] 形式存在
            assert "schemas: []" in content
            assert "constraints: []" in content
            assert "regex_nodes: []" in content

    def test_save_and_load_roundtrip_full(self):
        # 完整 roundtrip：包含 schemas/constraints/regex_nodes 全部
        m = ProjectManifest(
            version=2,
            project={"id": "full", "name": "Full"},
            schemas=[{"id": "users", "path": "schemas/users.yaml"}],
            constraints=[{"id": "c1", "path": "constraints/c1.yaml"}],
            regex_nodes=[{"id": "r1", "path": "regex/r1.yaml"}],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "project.precis.yaml")
            save_manifest(m, path)
            loaded = load_manifest(path)
            assert loaded.project.id == "full"
            assert len(loaded.schemas) == 1
            assert loaded.schemas[0].id == "users"
            assert len(loaded.constraints) == 1
            assert loaded.constraints[0].id == "c1"
            assert len(loaded.regex_nodes) == 1
            assert loaded.regex_nodes[0].id == "r1"

    def test_save_manifest_after_ensure_refs(self):
        # ensure_*_ref 后立即 save_manifest 验证完整流程
        m = ProjectManifest(version=2, project={"id": "flow", "name": "Flow"})
        ensure_schema_ref(m, "users")
        ensure_constraint_ref(m, "c1")
        ensure_regex_ref(m, "r1")
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "project.precis.yaml")
            save_manifest(m, path)
            loaded = load_manifest(path)
            assert loaded.schemas[0].id == "users"
            assert loaded.constraints[0].id == "c1"
            assert loaded.regex_nodes[0].id == "r1"

    def test_save_manifest_accepts_path_object(self):
        from pathlib import Path

        m = ProjectManifest(
            version=2,
            project={"id": "p", "name": "P"},
            schemas=[{"id": "x", "path": "x.yaml"}],
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manifest.yaml"
            save_manifest(m, path)
            assert path.exists()
            loaded = load_manifest(str(path))
            assert loaded.schemas[0].id == "x"
