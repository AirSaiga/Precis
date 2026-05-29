"""测试预览路径白名单模块"""

from __future__ import annotations

import os
from unittest.mock import patch

from app.shared.services.preview.path.whitelist import (
    _get_whitelist_search_paths,
    _parse_new_format,
    get_allowed_directories,
    is_path_in_allowed_directories,
    load_whitelist_config,
)


class TestGetWhitelistSearchPaths:
    def test_returns_list(self):
        paths = _get_whitelist_search_paths()
        assert isinstance(paths, list)
        assert len(paths) > 0
        assert all(os.path.isabs(p) for p in paths)

    def test_no_duplicates(self):
        paths = _get_whitelist_search_paths()
        assert len(paths) == len(set(paths))


class TestGetAllowedDirectories:
    def test_includes_home(self):
        dirs = get_allowed_directories()
        home = os.path.expanduser("~")
        assert home in dirs

    def test_common_dirs_if_exist(self):
        dirs = get_allowed_directories()
        home = os.path.expanduser("~")
        for sub in ["Documents", "Downloads", "Desktop"]:
            path = os.path.join(home, sub)
            if os.path.exists(path):
                assert path in dirs


class TestParseNewFormat:
    def test_valid_v2_format(self, tmp_path):
        config_dir = tmp_path / "allowed"
        config_dir.mkdir()
        content = f"""
version: "2.0"
paths:
  - path: {config_dir}
    policy: readonly
"""
        result = _parse_new_format(content)
        assert str(config_dir) in result

    def test_string_entries(self, tmp_path):
        config_dir = tmp_path / "allowed"
        config_dir.mkdir()
        path_str = str(config_dir).replace("\\", "/")
        content = f"""
version: "2.0"
paths:
  - "{path_str}"
"""
        result = _parse_new_format(content)
        assert str(config_dir) in result

    def test_invalid_version_returns_empty(self):
        content = """
version: "1.0"
paths:
  - /tmp
"""
        assert _parse_new_format(content) == []

    def test_not_dict_returns_empty(self):
        assert _parse_new_format("just a string") == []

    def test_yaml_error_returns_empty(self):
        assert _parse_new_format("{") == []

    def test_nonexistent_path_filtered(self):
        content = """
version: "2.0"
paths:
  - /nonexistent/path/12345
"""
        assert _parse_new_format(content) == []


class TestIsPathInAllowedDirectories:
    def test_existing_file_in_allowed(self, tmp_path, monkeypatch):
        f = tmp_path / "test.csv"
        f.write_text("data")
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.get_allowed_directories",
            lambda: [str(tmp_path)],
        )
        assert is_path_in_allowed_directories(str(f)) is True

    def test_existing_file_not_in_allowed(self, tmp_path, monkeypatch):
        f = tmp_path / "test.csv"
        f.write_text("data")
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.get_allowed_directories",
            lambda: [],
        )
        assert is_path_in_allowed_directories(str(f)) is False

    def test_nonexistent_must_exist_true(self, monkeypatch):
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.get_allowed_directories",
            lambda: [],
        )
        assert is_path_in_allowed_directories("/nonexistent/file.csv", must_exist=True) is False

    def test_nonexistent_must_exist_false(self, monkeypatch):
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.get_allowed_directories",
            lambda: [],
        )
        # must_exist=False 时文件不存在返回 True（仅检查格式）
        assert is_path_in_allowed_directories("/nonexistent/file.csv", must_exist=False) is True

    def test_exact_allowed_dir_match(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.get_allowed_directories",
            lambda: [str(tmp_path)],
        )
        assert is_path_in_allowed_directories(str(tmp_path), must_exist=True) is True

    def test_prefix_boundary(self, tmp_path, monkeypatch):
        allowed = tmp_path / "data"
        allowed.mkdir()
        not_allowed = tmp_path / "data_extra"
        not_allowed.mkdir()
        f = not_allowed / "file.csv"
        f.write_text("data")
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist.get_allowed_directories",
            lambda: [str(allowed)],
        )
        assert is_path_in_allowed_directories(str(f)) is False


class TestLoadWhitelistConfig:
    def test_missing_config_returns_default(self):
        with patch("os.path.isfile", return_value=False):
            result = load_whitelist_config()
            assert result == {"version": "1.0", "paths": []}

    def test_old_format_returns_v1(self, tmp_path, monkeypatch):
        config_file = tmp_path / ".precis-allowed-paths"
        config_file.write_text("# old comment format\n/path/to/dir")
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist._get_whitelist_search_paths",
            lambda: [str(tmp_path)],
        )
        result = load_whitelist_config()
        assert result == {"version": "1.0", "paths": []}

    def test_v2_yaml_format(self, tmp_path, monkeypatch):
        config_file = tmp_path / ".precis-allowed-paths"
        config_file.write_text('version: "2.0"\ndefault_policy: readonly\npaths: []')
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist._get_whitelist_search_paths",
            lambda: [str(tmp_path)],
        )
        result = load_whitelist_config()
        assert result.get("version") == "2.0"

    def test_empty_file_returns_default(self, tmp_path, monkeypatch):
        config_file = tmp_path / ".precis-allowed-paths"
        config_file.write_text("")
        monkeypatch.setattr(
            "app.shared.services.preview.path.whitelist._get_whitelist_search_paths",
            lambda: [str(tmp_path)],
        )
        result = load_whitelist_config()
        assert result == {"version": "1.0", "paths": []}
