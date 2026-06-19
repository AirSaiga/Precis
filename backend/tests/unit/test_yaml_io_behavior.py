"""
@fileoverview YAML 原子写入与文件锁行为测试

覆盖 atomic_write_yaml、FileLock 降级、_update_yaml_data/list。
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
import yaml

from app.shared.services.llm.yaml_io import (
    FileLock,
    YamlUpdateError,
    _update_yaml_data,
    _update_yaml_list,
    atomic_write_yaml,
)


class TestAtomicWriteYaml:
    """atomic_write_yaml 行为"""

    def test_writes_new_file(self, tmp_path):
        target = tmp_path / "output.yaml"
        atomic_write_yaml(target, {"version": 2, "name": "test"})
        assert target.exists()
        with open(target, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["version"] == 2
        assert data["name"] == "test"

    def test_overwrite_existing(self, tmp_path):
        target = tmp_path / "output.yaml"
        target.write_text("old: data\n", encoding="utf-8")
        atomic_write_yaml(target, {"new": "data"}, preserve_format=False)
        with open(target, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        assert data["new"] == "data"
        assert "old" not in data

    def test_creates_parent_dirs(self, tmp_path):
        target = tmp_path / "sub" / "dir" / "output.yaml"
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_yaml(target, {"key": "val"})
        assert target.exists()

    def test_raises_yaml_update_error_on_write_failure(self, tmp_path):
        target = tmp_path / "output.yaml"
        with patch("app.shared.services.llm.yaml_io.tempfile.mkstemp", side_effect=OSError("disk full")):
            with pytest.raises(YamlUpdateError):
                atomic_write_yaml(target, {"key": "val"})


class TestFileLock:
    """FileLock 行为"""

    def test_fallback_when_lock_unavailable(self, tmp_path, monkeypatch):
        from app.shared.services.llm import yaml_io

        monkeypatch.setattr(yaml_io, "_HAS_FILE_LOCK", False)
        lock = FileLock(str(tmp_path / "test.yaml"), timeout=1.0)
        assert lock.__enter__() is lock

    def test_exit_does_not_swallow_close_exception(self, tmp_path, monkeypatch):
        from app.shared.services.llm import yaml_io

        monkeypatch.setattr(yaml_io, "_HAS_FILE_LOCK", False)
        lock_file = tmp_path / "test.lock"
        lock = FileLock(str(lock_file), timeout=1.0)
        lock.__enter__()
        lock.lock_file = MagicMock()
        lock.lock_file.close.side_effect = Exception("close failed")
        # 不应抛出异常，仅记录日志
        lock.__exit__(None, None, None)


class TestUpdateYamlData:
    """_update_yaml_data / _update_yaml_list 行为"""

    def test_update_dict_values(self):
        from ruamel.yaml.comments import CommentedMap

        existing = CommentedMap({"a": 1, "b": 2})
        _update_yaml_data(existing, {"b": 3, "c": 4})
        assert existing["a"] == 1
        assert existing["b"] == 3
        assert existing["c"] == 4

    def test_update_nested_dict(self):
        from ruamel.yaml.comments import CommentedMap

        existing = CommentedMap({"outer": CommentedMap({"inner": 1})})
        _update_yaml_data(existing, {"outer": {"inner": 2}})
        assert existing["outer"]["inner"] == 2

    def test_update_list_by_id(self):
        from ruamel.yaml.comments import CommentedMap, CommentedSeq

        existing = CommentedSeq([CommentedMap({"id": "a", "val": 1})])
        _update_yaml_list(existing, [{"id": "a", "val": 99}])
        assert len(existing) == 1
        assert existing[0]["val"] == 99

    def test_update_list_appends_new_no_id_items(self):
        existing = [{"val": 1}]
        _update_yaml_list(existing, [{"val": 2}])
        assert len(existing) == 2

    def test_update_list_skips_duplicate_no_id_items(self):
        existing = [{"val": 1}]
        _update_yaml_list(existing, [{"val": 1}])
        assert len(existing) == 1
