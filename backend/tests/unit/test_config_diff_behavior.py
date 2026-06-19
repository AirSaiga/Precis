"""
@fileoverview 配置差异服务行为测试

覆盖 ConfigDiffService.compare 与 _build_property_diff 的真实差异输出。
"""

from __future__ import annotations

from pydantic import BaseModel

from app.shared.services.diff.config_diff import ConfigDiffService, DiffType


class TestConfigDiffService:
    """配置差异比对行为"""

    def test_detects_manifest_change(self):
        class FakeManifest(BaseModel):
            project_name: str = "test"

        old = {"manifest": FakeManifest(), "schemas": {}}
        new = {"manifest": FakeManifest(project_name="changed"), "schemas": {}}
        result = ConfigDiffService.compare(old, new)
        assert len(result.manifest) > 0
        assert result.manifest[0]["diff_type"] == "modified"

    def test_detects_resource_addition(self):
        class FakeSchema(BaseModel):
            id: str
            name: str

        old = {"manifest": {}, "schemas": {}}
        new = {"manifest": {}, "schemas": {"sc_new": FakeSchema(id="sc_new", name="New")}}
        result = ConfigDiffService.compare(old, new)
        added = [item for item in result.schemas if item.type == DiffType.ADDED]
        assert len(added) == 1
        assert added[0].id == "sc_new"

    def test_property_diff_detects_deleted_key(self):
        diffs = ConfigDiffService._build_property_diff({"a": 1, "b": 2}, {"a": 1}, [])
        deleted = [d for d in diffs if d.type == DiffType.DELETED]
        assert len(deleted) == 1
        assert deleted[0].key == "b"
        assert deleted[0].oldValue == 2

    def test_property_diff_detects_added_key(self):
        diffs = ConfigDiffService._build_property_diff({"a": 1}, {"a": 1, "b": 2}, [])
        added = [d for d in diffs if d.type == DiffType.ADDED]
        assert len(added) == 1
        assert added[0].key == "b"
        assert added[0].newValue == 2

    def test_property_diff_detects_modified_value(self):
        diffs = ConfigDiffService._build_property_diff({"a": 1}, {"a": 2}, [])
        modified = [d for d in diffs if d.type == DiffType.MODIFIED]
        assert len(modified) == 1
        assert modified[0].oldValue == 1
        assert modified[0].newValue == 2
