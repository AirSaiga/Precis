"""
@fileoverview Schema 版本管理模块单元测试

测试版本检查、解析、比较功能。
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import importlib.util

import pytest

# 直接加载 version.py 模块，绕过 schemas/__init__.py 中的循环导入
_version_path = os.path.join(_project_root, "app", "shared", "core", "manifest_schema", "version.py")
_version_spec = importlib.util.spec_from_file_location("version", _version_path)
assert _version_spec is not None, f"无法创建模块 spec: {_version_path}"
_version_mod = importlib.util.module_from_spec(_version_spec)
assert _version_spec.loader is not None, f"模块 spec 没有 loader: {_version_path}"
_version_spec.loader.exec_module(_version_mod)

CURRENT_VERSION = _version_mod.CURRENT_VERSION
MIN_SUPPORTED_VERSION = _version_mod.MIN_SUPPORTED_VERSION
MAX_SUPPORTED_VERSION = _version_mod.MAX_SUPPORTED_VERSION
is_supported_version = _version_mod.is_supported_version
get_version_info = _version_mod.get_version_info
parse_version = _version_mod.parse_version
compare_versions = _version_mod.compare_versions


class TestVersionConstants:
    def test_current_version_is_two(self):
        assert CURRENT_VERSION == 2

    def test_min_supported_version(self):
        assert MIN_SUPPORTED_VERSION == 2

    def test_max_supported_version(self):
        assert MAX_SUPPORTED_VERSION == 2


class TestIsSupportedVersion:
    def test_supported_versions(self):
        assert is_supported_version(2) is True

    def test_unsupported_versions(self):
        assert is_supported_version(0) is False
        assert is_supported_version(3) is False
        assert is_supported_version(-1) is False


class TestGetVersionInfo:
    def test_returns_expected_keys(self):
        info = get_version_info()
        assert info["current_version"] == CURRENT_VERSION
        assert info["min_supported_version"] == MIN_SUPPORTED_VERSION
        assert info["max_supported_version"] == MAX_SUPPORTED_VERSION
        assert info["supported_versions"] == [2]


class TestParseVersion:
    def test_full_version(self):
        assert parse_version("2.1.3") == (2, 1, 3)

    def test_partial_version(self):
        assert parse_version("1.0") == (1, 0, 0)

    def test_single_number(self):
        assert parse_version("3") == (3, 0, 0)

    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            parse_version("")


class TestCompareVersions:
    def test_less_than(self):
        assert compare_versions((1, 0, 0), (2, 0, 0)) == -1

    def test_equal(self):
        assert compare_versions((1, 2, 3), (1, 2, 3)) == 0

    def test_greater_than(self):
        assert compare_versions((2, 1, 0), (1, 9, 9)) == 1

    def test_tuple_comparison_semantics(self):
        # Python tuple comparison works lexicographically
        assert compare_versions((1, 0, 1), (1, 0, 0)) == 1
        assert compare_versions((1, 0, 0), (1, 0, 1)) == -1
