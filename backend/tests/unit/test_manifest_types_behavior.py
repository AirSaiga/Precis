"""
@fileoverview Manifest 类型行为测试

覆盖 ProjectManifest 默认值、去重、None 转空列表。
"""

from __future__ import annotations

from app.shared.core.project.manifest.types import ProjectInfo, ProjectManifest
from app.shared.core.project.manifest.types_parts.refs import SchemaRef


class TestProjectManifest:
    """ProjectManifest 行为"""

    def test_none_lists_coerced_to_empty(self):
        manifest = ProjectManifest(
            project=ProjectInfo(id="p", name="P"),
            schemas=None,
            constraints=None,
        )
        assert manifest.schemas == []
        assert manifest.constraints == []
        assert manifest.regex_nodes == []

    def test_duplicate_schema_ids_removed(self):
        manifest = ProjectManifest(
            project=ProjectInfo(id="p", name="P"),
            schemas=[
                SchemaRef(id="users", path="schemas/users.yaml"),
                SchemaRef(id="users", path="schemas/users_dup.yaml"),
            ],
        )
        assert len(manifest.schemas) == 1
        assert manifest.schemas[0].path == "schemas/users.yaml"
        assert any("重复" in w for w in manifest.warnings)

    def test_minimal_manifest_fields(self):
        manifest = ProjectManifest(
            version=2,
            project=ProjectInfo(id="proj1", name="My Project"),
        )
        assert manifest.version == 2
        assert manifest.project.id == "proj1"
