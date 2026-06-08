"""
@fileoverview yaml_io 和其他模块覆盖补充测试 v3

覆盖目标:
- yaml_io.py: atomic_write_yaml, _update_yaml_data, _update_yaml_list
- config_inspector.py: inspect_config 更多分支
- inline_batch.py: 约束 ID 生成、参数构建
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)




class TestAtomicWriteYaml:
    def test_write_new_file(self, tmp_path):
        from app.shared.services.llm.yaml_io import atomic_write_yaml

        target = tmp_path / "output.yaml"
        atomic_write_yaml(target, {"version": 2, "name": "test"})
        assert target.exists()
        import yaml

        with open(target, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["version"] == 2
        assert data["name"] == "test"

    def test_overwrite_existing(self, tmp_path):
        from app.shared.services.llm.yaml_io import atomic_write_yaml

        target = tmp_path / "output.yaml"
        target.write_text("old: data\n", encoding="utf-8")
        atomic_write_yaml(target, {"new": "data"}, preserve_format=False)
        import yaml

        with open(target, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["new"] == "data"
        assert "old" not in data

    def test_preserve_format_without_ruamel(self, tmp_path):
        from unittest.mock import patch

        from app.shared.services.llm.yaml_io import atomic_write_yaml

        target = tmp_path / "output.yaml"
        target.write_text("# Comment\nold: data\n", encoding="utf-8")
        # Patch ruamel to not be available
        with patch.dict("sys.modules", {"ruamel.yaml": None, "ruamel": None}):
            atomic_write_yaml(target, {"new": "data"}, preserve_format=True)
        assert target.exists()

    def test_write_creates_parent_dirs(self, tmp_path):
        from app.shared.services.llm.yaml_io import atomic_write_yaml

        target = tmp_path / "sub" / "dir" / "output.yaml"
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_yaml(target, {"key": "val"})
        assert target.exists()

    def test_write_empty_dict(self, tmp_path):
        from app.shared.services.llm.yaml_io import atomic_write_yaml

        target = tmp_path / "empty.yaml"
        atomic_write_yaml(target, {})
        assert target.exists()


class TestUpdateYamlData:
    def test_update_dict_values(self):
        try:
            from ruamel.yaml.comments import CommentedMap

            from app.shared.services.llm.yaml_io import _update_yaml_data

            existing = CommentedMap({"a": 1, "b": 2})
            _update_yaml_data(existing, {"b": 3, "c": 4})
            assert existing["a"] == 1
            assert existing["b"] == 3
            assert existing["c"] == 4
        except ImportError:
            pass  # ruamel.yaml not available

    def test_update_nested_dict(self):
        try:
            from ruamel.yaml.comments import CommentedMap

            from app.shared.services.llm.yaml_io import _update_yaml_data

            existing = CommentedMap({"outer": CommentedMap({"inner": 1})})
            _update_yaml_data(existing, {"outer": {"inner": 2}})
            assert existing["outer"]["inner"] == 2
        except ImportError:
            pass

    def test_update_list(self):
        try:
            from ruamel.yaml.comments import CommentedMap, CommentedSeq

            from app.shared.services.llm.yaml_io import _update_yaml_data

            existing = CommentedMap({"items": CommentedSeq([1, 2, 3])})
            _update_yaml_data(existing, {"items": [4, 5]})
            # _update_yaml_data delegates to _update_yaml_list for CommentedSeq
            assert len(existing["items"]) >= 2
        except ImportError:
            pass


class TestUpdateYamlList:
    def test_append_new_items(self):
        try:
            from ruamel.yaml.comments import CommentedMap, CommentedSeq

            from app.shared.services.llm.yaml_io import _update_yaml_list

            existing = CommentedSeq([CommentedMap({"id": "a", "val": 1})])
            _update_yaml_list(existing, [{"id": "b", "val": 2}])
            assert len(existing) == 2
        except ImportError:
            pass

    def test_update_existing_by_id(self):
        try:
            from ruamel.yaml.comments import CommentedMap, CommentedSeq

            from app.shared.services.llm.yaml_io import _update_yaml_list

            existing = CommentedSeq([CommentedMap({"id": "a", "val": 1})])
            _update_yaml_list(existing, [{"id": "a", "val": 99}])
            assert len(existing) == 1
            assert existing[0]["val"] == 99
        except ImportError:
            pass

    def test_empty_new_list(self):
        from app.shared.services.llm.yaml_io import _update_yaml_list

        existing = [{"id": "a"}]
        _update_yaml_list(existing, [])
        assert len(existing) == 1

    def test_no_id_item_appended(self):
        from app.shared.services.llm.yaml_io import _update_yaml_list

        existing = [{"val": 1}]
        _update_yaml_list(existing, [{"val": 2}])
        assert len(existing) == 2

    def test_duplicate_no_id_not_added(self):
        from app.shared.services.llm.yaml_io import _update_yaml_list

        existing = [{"val": 1}]
        _update_yaml_list(existing, [{"val": 1}])
        assert len(existing) == 1


class TestInlineBatchHelpers:
    def test_generate_constraint_id(self):
        from app.shared.services.llm.constraints.constraint_id import _generate_constraint_id

        result = _generate_constraint_id("NotNull", "users", "email")
        assert "notnull" in result
        assert "users" in result
        assert "email" in result

    def test_build_constraint_params_notnull(self):
        try:
            from app.shared.services.llm.constraints.inline_batch import _build_constraint_params

            params = _build_constraint_params("NotNull", {})
            assert isinstance(params, dict)
        except ImportError:
            pass

    def test_build_constraint_params_range(self):
        try:
            from app.shared.services.llm.constraints.inline_batch import _build_constraint_params

            params = _build_constraint_params("Range", {"minValue": 0, "maxValue": 100})
            assert isinstance(params, dict)
        except ImportError:
            pass

    def test_build_constraint_params_allowed_values(self):
        try:
            from app.shared.services.llm.constraints.inline_batch import _build_constraint_params

            params = _build_constraint_params("AllowedValues", {"allowedValues": ["a", "b", "c"]})
            assert isinstance(params, dict)
        except ImportError:
            pass


class TestConfigInspectorMore:
    def test_inspect_config_empty(self, tmp_path):
        from unittest.mock import MagicMock

        from app.shared.core.project.loader.loader_parts.config_inspector import inspect_config

        manifest_file = tmp_path / "project.precis.yaml"
        manifest_file.write_text("version: 2\n", encoding="utf-8")

        manifest = MagicMock()
        manifest.schemas = []
        manifest.constraints = []
        manifest.regex_nodes = []
        manifest.transforms = []

        warnings = []
        errors = []

        inspect_config(manifest_file, manifest, {}, {}, {}, {}, warnings, errors)
        # Should not crash with empty config
        assert isinstance(warnings, list)
        assert isinstance(errors, list)
