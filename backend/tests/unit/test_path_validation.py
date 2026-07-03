"""path_validation 模块单元测试

覆盖:
- assert_no_traversal: 反穿越校验(拒绝 `..`、resolve 解析 symlink)
- assert_path_within_root: 白名单语义(限定到指定根)
- validate_file_access: 兼容入口(委托 assert_no_traversal)
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.shared.services.preview.path_validation import (
    assert_no_traversal,
    assert_path_within_root,
    validate_file_access,
)


class TestAssertNoTraversal:
    def test_empty_path_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            assert_no_traversal("")
        assert exc_info.value.status_code == 400

    def test_whitespace_path_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            assert_no_traversal("   ")
        assert exc_info.value.status_code == 400

    def test_nonexistent_required_raises_404(self, tmp_path):
        missing = str(tmp_path / "nonexistent.csv")
        with pytest.raises(HTTPException) as exc_info:
            assert_no_traversal(missing, must_exist=True)
        assert exc_info.value.status_code == 404

    def test_nonexistent_allowed_when_must_exist_false(self, tmp_path):
        """must_exist=False 时允许不存在的路径(写场景)"""
        missing = str(tmp_path / "new_file.txt")
        result = assert_no_traversal(missing, must_exist=False)
        assert Path(result).resolve() == Path(missing).resolve()

    def test_existing_file_passes(self, tmp_path):
        f = tmp_path / "data.csv"
        f.write_text("a,b\n1,2", encoding="utf-8")
        result = assert_no_traversal(str(f))
        assert Path(result).exists()

    def test_dotdot_segment_rejected(self, tmp_path):
        """路径含 `..` 段被拒绝(防穿越)"""
        traversing = str(tmp_path / ".." / "secret.txt")
        with pytest.raises(HTTPException) as exc_info:
            assert_no_traversal(traversing)
        assert exc_info.value.status_code == 400

    def test_absolute_path_with_dotdot_rejected(self, tmp_path):
        """绝对路径中的 `..` 成分也被拒绝(用 OS 分隔符确保 .. 是独立段)"""
        sep = os.sep
        traversing = f"{tmp_path}{sep}..{sep}etc{sep}passwd"
        with pytest.raises(HTTPException) as exc_info:
            assert_no_traversal(traversing)
        assert exc_info.value.status_code == 400

    def test_project_external_file_allowed(self, tmp_path):
        """用户在项目外选择的合法数据文件应被允许(核心用例)"""
        external = tmp_path / "external_data.csv"
        external.write_text("x,y\n1,2", encoding="utf-8")
        result = assert_no_traversal(str(external))
        assert Path(result).exists()


class TestAssertPathWithinRoot:
    def test_empty_path_raises_400(self, tmp_path):
        with pytest.raises(HTTPException) as exc_info:
            assert_path_within_root("", str(tmp_path))
        assert exc_info.value.status_code == 400

    def test_path_inside_root_allowed(self, tmp_path):
        """根目录内的文件允许"""
        sub = tmp_path / "sub"
        sub.mkdir()
        f = sub / "file.txt"
        f.write_text("ok", encoding="utf-8")
        result = assert_path_within_root(str(f), str(tmp_path))
        assert Path(result).exists()

    def test_path_outside_root_rejected(self, tmp_path):
        """根目录外的文件被拒绝(白名单语义)"""
        outside = tmp_path.parent / "sibling_dir" / "file.txt"
        with pytest.raises(HTTPException) as exc_info:
            assert_path_within_root(str(outside), str(tmp_path), must_exist=False)
        assert exc_info.value.status_code == 403

    def test_dotdot_escape_rejected(self, tmp_path):
        """`..` 逃逸根目录被拒绝"""
        escaping = str(tmp_path / ".." / "passwd")
        with pytest.raises(HTTPException) as exc_info:
            assert_path_within_root(escaping, str(tmp_path), must_exist=False)
        assert exc_info.value.status_code == 403

    def test_root_itself_allowed(self, tmp_path):
        """根目录本身允许"""
        result = assert_path_within_root(str(tmp_path), str(tmp_path), must_exist=True)
        assert Path(result).exists()

    def test_spoofed_prefix_rejected(self, tmp_path):
        """前缀字符串相似但不在根内的路径被拒绝(防 /root vs /rootkit 之类)"""
        # tmp_path = .../abc,构造 .../abc_evil 应被拒
        spoofed = str(tmp_path) + "_evil"
        with pytest.raises(HTTPException) as exc_info:
            assert_path_within_root(spoofed, str(tmp_path), must_exist=False)
        assert exc_info.value.status_code == 403


class TestValidateFileAccessCompatibility:
    """validate_file_access 兼容入口:委托 assert_no_traversal 并返回解析路径"""

    def test_empty_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access("")
        assert exc_info.value.status_code == 400

    def test_returns_resolved_path(self, tmp_path):
        f = tmp_path / "data.csv"
        f.write_text("a,b\n1,2", encoding="utf-8")
        result = validate_file_access(str(f))
        assert isinstance(result, str)
        assert Path(result).exists()

    def test_dotdot_rejected(self, tmp_path):
        with pytest.raises(HTTPException) as exc_info:
            validate_file_access(str(tmp_path / ".." / "x"))
        assert exc_info.value.status_code == 400
