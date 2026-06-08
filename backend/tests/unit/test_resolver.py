"""
@fileoverview 数据源路径解析器测试（T48 覆盖补充）

覆盖目标:
- services/validation/resolver.py: DataSourceResolver 全路径
  - resolve_first_data_source: 绝对/相对路径、目录不存在
  - resolve_source_path: 显式 source、自动发现、Sheet 名称提取
"""

import os
import sys

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from unittest.mock import MagicMock

from app.shared.services.validation.resolver import DataSourceResolver


def _make_manifest(data_sources=None):
    manifest = MagicMock()
    manifest.data_sources = data_sources or []
    return manifest


def _make_schema_file(name="users", id="users", sheet=None, source=None):
    sf = MagicMock()
    sf.name = name
    sf.id = id
    sf.sheet = sheet
    sf.source = source
    return sf


def _make_data_source(path, mode="relative", ds_id="primary"):
    ds = MagicMock()
    ds.path = path
    ds.mode = mode
    ds.id = ds_id
    return ds


# ============================================================================
# resolve_first_data_source 测试
# ============================================================================


class TestResolveFirstDataSource:
    def test_no_data_sources(self, tmp_path):
        """无数据源配置时应返回 None。"""
        manifest = _make_manifest([])
        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        assert resolver.resolve_first_data_source() is None

    def test_relative_path_exists(self, tmp_path):
        """相对路径数据源目录存在时应返回绝对路径。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        manifest = _make_manifest([_make_data_source("data", mode="relative")])
        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        result = resolver.resolve_first_data_source()
        assert result == str(data_dir)

    def test_relative_path_not_exists(self, tmp_path):
        """相对路径数据源目录不存在时应返回 None。"""
        manifest = _make_manifest([_make_data_source("nonexistent", mode="relative")])
        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        assert resolver.resolve_first_data_source() is None

    def test_absolute_path_exists(self, tmp_path):
        """绝对路径数据源目录存在时应返回该路径。"""
        data_dir = tmp_path / "abs_data"
        data_dir.mkdir()
        manifest = _make_manifest([_make_data_source(str(data_dir), mode="absolute")])
        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        result = resolver.resolve_first_data_source()
        assert result == str(data_dir)

    def test_absolute_path_not_exists(self, tmp_path):
        """绝对路径数据源目录不存在时应返回 None。"""
        manifest = _make_manifest([_make_data_source("/nonexistent/abs/path", mode="absolute")])
        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        assert resolver.resolve_first_data_source() is None


# ============================================================================
# resolve_source_path 测试
# ============================================================================


class TestResolveSourcePath:
    def test_absolute_file_mode(self, tmp_path):
        """absolute_file 模式应直接返回路径。"""
        source = MagicMock()
        source.mode = "absolute_file"
        source.path = str(tmp_path / "users.xlsx")
        source.sheet = None
        schema_file = _make_schema_file(source=source)

        resolver = DataSourceResolver(str(tmp_path), _make_manifest(), {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert path == str(tmp_path / "users.xlsx")

    def test_relative_source_file_exists(self, tmp_path):
        """相对路径 source 文件存在时应返回绝对路径。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        csv_file = data_dir / "users.csv"
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        source = MagicMock()
        source.mode = "relative_file"
        source.path = "data/users.csv"
        source.sheet = None
        schema_file = _make_schema_file(source=source)

        resolver = DataSourceResolver(str(tmp_path), _make_manifest(), {})
        path, sheet = resolver.resolve_source_path(str(data_dir), schema_file)
        assert path == str(csv_file)

    def test_sheet_from_schema_file(self, tmp_path):
        """Sheet 名称应从 schema_file.sheet 提取。"""
        source = MagicMock()
        source.mode = "absolute_file"
        source.path = str(tmp_path / "data.xlsx")
        source.sheet = None
        schema_file = _make_schema_file(sheet="Sheet1", source=source)

        resolver = DataSourceResolver(str(tmp_path), _make_manifest(), {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert sheet == "Sheet1"

    def test_sheet_from_source(self, tmp_path):
        """Sheet 名称应从 source.sheet 提取（当 schema_file.sheet 为空时）。"""
        source = MagicMock()
        source.mode = "absolute_file"
        source.path = str(tmp_path / "data.xlsx")
        source.sheet = "Sheet2"
        schema_file = _make_schema_file(sheet=None, source=source)

        resolver = DataSourceResolver(str(tmp_path), _make_manifest(), {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert sheet == "Sheet2"

    def test_auto_discover_csv_in_root(self, tmp_path):
        """自动发现：在数据目录根目录中找到 CSV 文件。"""
        csv_file = tmp_path / "users.csv"
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        schema_file = _make_schema_file(name="users", source=None)
        manifest = _make_manifest()

        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert path == str(csv_file)

    def test_auto_discover_in_subdirectory(self, tmp_path):
        """自动发现：在子目录中找到数据文件。"""
        sub = tmp_path / "subdir"
        sub.mkdir()
        csv_file = sub / "orders.csv"
        csv_file.write_text("id,total\n1,100\n", encoding="utf-8")

        schema_file = _make_schema_file(name="orders", source=None)
        manifest = _make_manifest()

        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert path == str(csv_file)

    def test_auto_discover_with_sheet_name(self, tmp_path):
        """有 Sheet 名称时只搜索 Excel 扩展名。"""
        csv_file = tmp_path / "users.csv"
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        schema_file = _make_schema_file(name="users", sheet="Sheet1", source=None)
        manifest = _make_manifest()

        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        # Should not find CSV because sheet_name restricts to Excel
        assert path is None

    def test_auto_discover_not_found(self, tmp_path):
        """自动发现找不到文件时应返回 None。"""
        schema_file = _make_schema_file(name="nonexistent", source=None)
        manifest = _make_manifest()

        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert path is None

    def test_auto_discover_skips_special_dirs(self, tmp_path):
        """自动发现应跳过 .git、node_modules 等目录。"""
        # Create file in .git directory (should be skipped)
        git_dir = tmp_path / ".git"
        git_dir.mkdir()
        (git_dir / "users.csv").write_text("id\n1\n", encoding="utf-8")

        # Create file in normal directory
        sub = tmp_path / "data"
        sub.mkdir()
        (sub / "users.csv").write_text("id\n1\n", encoding="utf-8")

        schema_file = _make_schema_file(name="users", source=None)
        manifest = _make_manifest()

        resolver = DataSourceResolver(str(tmp_path), manifest, {})
        path, sheet = resolver.resolve_source_path(str(tmp_path), schema_file)
        assert path == str(sub / "users.csv")

    def test_adjusted_path_with_project_dir_prefix(self, tmp_path):
        """处理路径中多余的项目目录前缀。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        csv_file = data_dir / "users.csv"
        csv_file.write_text("id,name\n1,alice\n", encoding="utf-8")

        # source path has project dir as prefix
        source = MagicMock()
        source.mode = "relative_file"
        source.path = f"{tmp_path.name}/data/users.csv"
        source.sheet = None
        schema_file = _make_schema_file(source=source)

        resolver = DataSourceResolver(str(tmp_path), _make_manifest(), {})
        path, sheet = resolver.resolve_source_path(str(data_dir), schema_file)
        # Should find the file via adjusted path
        assert path is not None
