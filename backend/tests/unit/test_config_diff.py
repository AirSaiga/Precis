"""
@fileoverview ConfigDiffService 单元测试

覆盖 compare、_compare_resources、_build_property_diff、_diff_recursive 的未覆盖分支。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from pydantic import BaseModel

from app.shared.services.diff.config_diff import ConfigDiffService, DiffType


class MockModel(BaseModel):
    name: str
    value: int = 0


class TestConfigDiffService:
    def test_empty_configs(self):
        result = ConfigDiffService.compare({}, {})
        assert result.schemas == []
        assert result.constraints == []
        assert result.regex_nodes == []

    def test_added_schema(self):
        old = {"schemas": {"users": {"name": "users"}}}
        new = {"schemas": {"users": {"name": "users"}, "orders": {"name": "orders"}}}
        result = ConfigDiffService.compare(old, new)
        assert len(result.schemas) == 1
        assert result.schemas[0].type == DiffType.ADDED
        assert result.schemas[0].id == "orders"

    def test_modified_schema(self):
        old = {"schemas": {"users": {"name": "users", "cols": 2}}}
        new = {"schemas": {"users": {"name": "users", "cols": 3}}}
        result = ConfigDiffService.compare(old, new)
        assert len(result.schemas) == 1
        assert result.schemas[0].type == DiffType.MODIFIED
        assert any(c.key == "cols" for c in result.schemas[0].changes)

    def test_with_pydantic_models(self):
        old = {"schemas": {"users": MockModel(name="users")}}
        new = {"schemas": {"users": MockModel(name="users", value=1)}}
        result = ConfigDiffService.compare(old, new)
        assert len(result.schemas) == 1
        assert result.schemas[0].type == DiffType.MODIFIED

    def test_manifest_diff(self):
        old = {"manifest": {"version": 1}}
        new = {"manifest": {"version": 2, "name": "test"}}
        result = ConfigDiffService.compare(old, new)
        assert len(result.manifest) == 2

    def test_list_diff(self):
        old = {"manifest": {"items": [1, 2]}}
        new = {"manifest": {"items": [1, 2, 3]}}
        result = ConfigDiffService.compare(old, new)
        assert any(d["diff_type"] == "added" for d in result.manifest)

    def test_list_shortened(self):
        old = {"manifest": {"items": [1, 2, 3]}}
        new = {"manifest": {"items": [1]}}
        result = ConfigDiffService.compare(old, new)
        assert any(d["diff_type"] == "removed" for d in result.manifest)

    def test_nested_dict_diff(self):
        old = {"schemas": {"users": {"config": {"a": 1}}}}
        new = {"schemas": {"users": {"config": {"a": 2, "b": 3}}}}
        result = ConfigDiffService.compare(old, new)
        changes = result.schemas[0].changes
        assert any(c.key == "config.a" and c.type == DiffType.MODIFIED for c in changes)
        assert any(c.key == "config.b" and c.type == DiffType.ADDED for c in changes)

    def test_non_dict_property_diff(self):
        old = {"schemas": {"users": "string_val"}}
        new = {"schemas": {"users": "string_val"}}
        result = ConfigDiffService.compare(old, new)
        assert result.schemas == []
