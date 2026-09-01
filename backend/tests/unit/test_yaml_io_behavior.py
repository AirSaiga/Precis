"""
@fileoverview YAML 原子写入与文件锁行为测试

覆盖 atomic_write_yaml、FileLock 降级、陈旧锁接管、_update_yaml_data/list。
"""

from __future__ import annotations

import os
import time
from unittest.mock import MagicMock, patch

import pytest
import yaml

from app.shared.services.llm import yaml_io as yaml_io_module
from app.shared.services.llm.yaml_io import (
    STALE_LOCK_SECONDS,
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


class TestFileLockStaleDetection:
    """陈旧锁检测与释放所有权重验"""

    def test_stale_lock_is_taken_over(self, tmp_path):
        """崩溃残留的陈旧锁（mtime 超过阈值）应被删除并接管，可立即获取。"""
        lock_path = tmp_path / "test.yaml.lock"
        lock_path.write_text("", encoding="utf-8")
        old = time.time() - (STALE_LOCK_SECONDS + 60)
        os.utime(lock_path, (old, old))

        lock = FileLock(str(tmp_path / "test.yaml"), timeout=1.0)
        with lock:
            # 进入 with 即说明陈旧锁已被删除并成功获取
            assert lock._lock_token
            assert lock_path.exists()
        assert not lock_path.exists()

    def test_fresh_lock_blocks_until_timeout(self, tmp_path):
        """新鲜锁（mtime 未超阈值）不被接管：独占创建失败直至超时。

        仅 Windows 独占创建（open 'x'）语义适用；Unix 的 flock 不被残留文件阻塞。
        """
        if yaml_io_module.msvcrt is None:
            pytest.skip("独占创建语义仅 Windows 适用，Unix flock 不会被残留文件阻塞")
        lock_path = tmp_path / "test.yaml.lock"
        lock_path.write_text("", encoding="utf-8")

        lock = FileLock(str(tmp_path / "test.yaml"), timeout=0.3)
        with pytest.raises(YamlUpdateError, match="获取文件锁超时"):
            lock.__enter__()
        # 超时后原锁文件保留（不属于本进程，不得删除）
        assert lock_path.exists()

    def test_lock_file_contains_owner_token(self, tmp_path):
        """获取锁时写入唯一令牌，供释放前重验归属。"""
        lock_path = tmp_path / "test.yaml.lock"
        lock = FileLock(str(tmp_path / "test.yaml"), timeout=1.0)
        with lock:
            assert lock._lock_token
            with open(lock_path, encoding="utf-8") as f:
                assert f.read() == lock._lock_token
        assert not lock_path.exists()

    def test_release_skips_delete_when_lock_taken_over(self, tmp_path):
        """释放前重验所有权：锁文件已被他人重建（内容非自己令牌）时不得误删。"""
        lock_path = tmp_path / "test.yaml.lock"
        lock = FileLock(str(tmp_path / "test.yaml"), timeout=1.0)
        lock.__enter__()
        assert lock._lock_token
        # 模拟本锁被陈旧检测接管后由其他持有者重建：内容被替换为他人令牌
        with open(lock_path, "w", encoding="utf-8") as f:
            f.write("other-owner-token")

        lock.__exit__(None, None, None)

        # 他人的锁文件必须保留
        assert lock_path.exists()
        with open(lock_path, encoding="utf-8") as f:
            assert f.read() == "other-owner-token"

    def test_release_lock_file_already_gone(self, tmp_path):
        """释放时锁文件已不存在（被接管删除）不应报错。"""
        lock_path = tmp_path / "test.yaml.lock"
        lock = FileLock(str(tmp_path / "test.yaml"), timeout=1.0)
        lock.__enter__()
        # 手动关闭真实句柄后删除锁文件（Windows 不允许删除打开中的文件），
        # 模拟"释放时锁文件已被他人接管删除"
        lock.lock_file.close()
        lock.lock_file = MagicMock()
        lock_path.unlink()
        lock.__exit__(None, None, None)  # FileNotFoundError 分支：不应抛异常


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
