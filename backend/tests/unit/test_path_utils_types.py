"""
@fileoverview 路径工具和预览路径类型测试（T48 覆盖补充）

覆盖目标:
- core/utils/path_utils.py: normalize_to_posix, paths_equal, make_relative
- services/preview/path/types.py: PathPolicy, WhitelistEntry
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.shared.core.utils.path_utils import make_relative, normalize_to_posix, paths_equal
from app.shared.services.preview.path.types import PathPolicy, WhitelistEntry

# ============================================================================
# normalize_to_posix 测试
# ============================================================================


class TestNormalizeToPosix:
    def test_backslash_to_forward_slash(self):
        assert normalize_to_posix("C:\\Users\\test\\file.csv") == "C:/Users/test/file.csv"

    def test_consecutive_slashes_collapsed(self):
        assert normalize_to_posix("a//b///c") == "a/b/c"

    def test_trailing_slash_removed(self):
        assert normalize_to_posix("a/b/c/") == "a/b/c"

    def test_empty_string(self):
        assert normalize_to_posix("") == ""

    def test_single_slash(self):
        assert normalize_to_posix("/") == ""

    def test_mixed_separators(self):
        assert normalize_to_posix("a\\b/c\\d") == "a/b/c/d"

    def test_already_normalized(self):
        assert normalize_to_posix("a/b/c") == "a/b/c"

    def test_backslash_trailing(self):
        assert normalize_to_posix("a\\b\\") == "a/b"


# ============================================================================
# paths_equal 测试
# ============================================================================


class TestPathsEqual:
    def test_same_path(self):
        assert paths_equal("a/b/c", "a/b/c") is True

    def test_different_case_ignore(self):
        assert paths_equal("A/B/C", "a/b/c", ignore_case=True) is True

    def test_different_case_respect(self):
        assert paths_equal("A/B/C", "a/b/c", ignore_case=False) is False

    def test_backslash_vs_forward(self):
        assert paths_equal("a\\b\\c", "a/b/c") is True

    def test_trailing_slash_difference(self):
        assert paths_equal("a/b/c/", "a/b/c") is True

    def test_consecutive_slashes(self):
        assert paths_equal("a//b///c", "a/b/c") is True

    def test_different_paths(self):
        assert paths_equal("a/b/c", "a/b/d") is False

    def test_empty_paths(self):
        assert paths_equal("", "") is True

    def test_mixed_separators_and_case(self):
        assert paths_equal("C:\\Users\\Test", "c:/users/test") is True


# ============================================================================
# make_relative 测试
# ============================================================================


class TestMakeRelative:
    def test_relative_path(self):
        result = make_relative("/a/b", "/a/b/c/d")
        assert result == "c/d"

    def test_same_directory(self):
        result = make_relative("/a/b", "/a/b")
        assert result == "."

    def test_parent_directory(self):
        result = make_relative("/a/b/c", "/a/b")
        assert result == ".."


# ============================================================================
# PathPolicy 测试
# ============================================================================


class TestPathPolicy:
    def test_readonly_value(self):
        assert PathPolicy.READONLY == "readonly"
        assert PathPolicy.READONLY.value == "readonly"

    def test_admin_value(self):
        assert PathPolicy.ADMIN == "admin"
        assert PathPolicy.ADMIN.value == "admin"

    def test_owner_value(self):
        assert PathPolicy.OWNER == "owner"
        assert PathPolicy.OWNER.value == "owner"

    def test_is_string_subclass(self):
        assert isinstance(PathPolicy.READONLY, str)

    def test_all_members(self):
        members = list(PathPolicy)
        assert len(members) == 3


# ============================================================================
# WhitelistEntry 测试
# ============================================================================


class TestWhitelistEntry:
    def test_default_values(self):
        entry = WhitelistEntry(path="/data")
        assert entry.path == "/data"
        assert entry.policy == PathPolicy.READONLY
        assert entry.owner_id is None
        assert entry.description is None

    def test_custom_values(self):
        entry = WhitelistEntry(
            path="/admin/data",
            policy=PathPolicy.ADMIN,
            owner_id="user1",
            description="Admin data directory",
        )
        assert entry.path == "/admin/data"
        assert entry.policy == PathPolicy.ADMIN
        assert entry.owner_id == "user1"
        assert entry.description == "Admin data directory"

    def test_owner_policy(self):
        entry = WhitelistEntry(
            path="/private",
            policy=PathPolicy.OWNER,
            owner_id="user42",
        )
        assert entry.policy == PathPolicy.OWNER
        assert entry.owner_id == "user42"
