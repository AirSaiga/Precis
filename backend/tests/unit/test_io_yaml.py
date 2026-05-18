"""YAML 读写工具单元测试"""

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import tempfile
from pathlib import Path

import pytest

from app.shared.core.io.yaml import read_yaml, write_yaml


class TestReadYaml:
    """read_yaml 单元测试"""

    def test_read_yaml_simple(self):
        """读取简单 YAML 文件并验证解析结果"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.yaml"
            file_path.write_text("name: test\nversion: 2\n", encoding="utf-8")
            result = read_yaml(file_path)

        assert result["name"] == "test"
        assert result["version"] == 2

    def test_read_yaml_nested(self):
        """读取嵌套 YAML 文件"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "nested.yaml"
            file_path.write_text(
                "project:\n  id: my-project\n  settings:\n    enabled: true\n",
                encoding="utf-8",
            )
            result = read_yaml(file_path)

        assert result["project"]["id"] == "my-project"
        assert result["project"]["settings"]["enabled"] is True

    def test_read_yaml_list(self):
        """读取包含列表的 YAML 文件"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "list.yaml"
            file_path.write_text("items:\n  - a\n  - b\n  - c\n", encoding="utf-8")
            result = read_yaml(file_path)

        assert result["items"] == ["a", "b", "c"]

    def test_read_yaml_file_not_found(self):
        """读取不存在的文件应抛出 FileNotFoundError"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "not_exist.yaml"
        with pytest.raises(FileNotFoundError):
            read_yaml(file_path)


class TestWriteYaml:
    """write_yaml 单元测试"""

    def test_write_yaml_creates_file(self):
        """写入 YAML 文件并验证文件存在"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "output.yaml"
            data = {"name": "test", "version": 2}
            write_yaml(file_path, data)

            assert file_path.exists()
            content = file_path.read_text(encoding="utf-8")
            assert "name: test" in content
            assert "version: 2" in content

    def test_write_yaml_creates_parent_dirs(self):
        """写入时会自动创建父目录"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "subdir" / "nested" / "output.yaml"
            data = {"key": "value"}
            write_yaml(file_path, data)

            assert file_path.exists()

    def test_write_yaml_preserves_chinese(self):
        """写入 YAML 时保留中文字符"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "chinese.yaml"
            data = {"name": "中文测试", "description": "这是描述"}
            write_yaml(file_path, data)

            content = file_path.read_text(encoding="utf-8")
            assert "中文测试" in content
            assert "这是描述" in content

    def test_write_yaml_preserves_key_order(self):
        """写入 YAML 时保持键顺序"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "order.yaml"
            data = {"z": 1, "a": 2, "m": 3}
            write_yaml(file_path, data)

            content = file_path.read_text(encoding="utf-8")
            lines = [line.strip() for line in content.splitlines() if line.strip()]
            # safe_dump 默认会在顶层键前加空行，但顺序应保持
            keys_in_order = [line.split(":")[0] for line in lines]
            assert keys_in_order == ["z", "a", "m"]

    def test_write_yaml_overwrites_existing(self):
        """写入 YAML 时覆盖已有内容"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "overwrite.yaml"
            file_path.write_text("old: data\n", encoding="utf-8")
            data = {"new": "content"}
            write_yaml(file_path, data)

            content = file_path.read_text(encoding="utf-8")
            assert "old: data" not in content
            assert "new: content" in content

    def test_roundtrip_read_write(self):
        """读写完整体校验"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "roundtrip.yaml"
            original = {
                "version": 2,
                "project": {"id": "test", "name": "测试项目"},
                "items": [{"id": 1}, {"id": 2}],
            }
            write_yaml(file_path, original)
            loaded = read_yaml(file_path)

        assert loaded == original
