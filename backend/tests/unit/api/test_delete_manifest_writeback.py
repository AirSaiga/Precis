"""@fileoverview schema/constraint/regex 删除端点 manifest 写回测试

覆盖 B-fix: 删除端点的写回条件应为"该引用原本存在于 manifest 中就写回"，
即使删除后引用列表为空也必须写回——manifest 不得残留指向已删除文件的悬空引用。
三个删除端点（schema / constraint / regex）行为保持一致。
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import yaml

from app.api.routers.project.constraint import delete_v2_constraint
from app.api.routers.project.regex import delete_v2_regex_node
from app.api.routers.project.schema import delete_v2_schema


def _make_project(root: Path, manifest_yaml: str) -> str:
    """创建含 manifest 的最小项目根，返回 config_path。"""
    root.mkdir(parents=True, exist_ok=True)
    (root / "project.precis.yaml").write_text(manifest_yaml, encoding="utf-8")
    return str(root)


def _read_manifest(root: Path) -> dict:
    return yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))


def test_delete_last_schema_ref_writes_back_empty_manifest():
    """删除 manifest 中最后一个 schema 引用后，manifest 写回为空（无悬空引用）。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        config_path = _make_project(
            root,
            "version: 2\n"
            "project:\n"
            "  id: p\n"
            "  name: p\n"
            "schemas:\n"
            "  - id: users\n"
            "    path: schemas/users.schema.yaml\n"
            "constraints: []\n"
            "regex_nodes: []\n",
        )
        schema_file = root / "schemas" / "users.schema.yaml"
        schema_file.parent.mkdir()
        schema_file.write_text("id: users\ncolumns: []\n", encoding="utf-8")

        result = delete_v2_schema("users", config_path=config_path)
        assert "已删除" in result["message"]
        assert not schema_file.exists()

        saved = _read_manifest(root)
        assert saved.get("schemas", []) == []


def test_delete_last_constraint_ref_writes_back_empty_manifest():
    """删除 manifest 中最后一个 constraint 引用后，manifest 写回为空（无悬空引用）。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        config_path = _make_project(
            root,
            "version: 2\n"
            "project:\n"
            "  id: p\n"
            "  name: p\n"
            "schemas: []\n"
            "constraints:\n"
            "  - id: c_notnull\n"
            "    path: constraints/c_notnull.constraint.yaml\n"
            "regex_nodes: []\n",
        )
        constraint_file = root / "constraints" / "c_notnull.constraint.yaml"
        constraint_file.parent.mkdir()
        constraint_file.write_text("id: c_notnull\n", encoding="utf-8")

        result = delete_v2_constraint("c_notnull", config_path=config_path)
        assert "已删除" in result["message"]
        assert not constraint_file.exists()

        saved = _read_manifest(root)
        assert saved.get("constraints", []) == []


def test_delete_last_regex_ref_writes_back_empty_manifest():
    """删除 manifest 中最后一个 regex 引用后，manifest 写回为空（无悬空引用）。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        config_path = _make_project(
            root,
            "version: 2\n"
            "project:\n"
            "  id: p\n"
            "  name: p\n"
            "schemas: []\n"
            "constraints: []\n"
            "regex_nodes:\n"
            "  - id: r_phone\n"
            "    path: regex/r_phone.regex.yaml\n",
        )
        regex_file = root / "regex" / "r_phone.regex.yaml"
        regex_file.parent.mkdir()
        regex_file.write_text("id: r_phone\n", encoding="utf-8")

        result = delete_v2_regex_node("r_phone", config_path=config_path)
        assert "已删除" in result["message"]
        assert not regex_file.exists()

        saved = _read_manifest(root)
        assert saved.get("regex_nodes", []) == []


def test_delete_ref_only_on_disk_does_not_rewrite_manifest():
    """对照: 引用仅在磁盘目录扫描中存在（manifest 无该引用）时，不应无谓重写 manifest。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        manifest_yaml = "version: 2\nproject:\n  id: p\n  name: p\nschemas: []\nconstraints: []\nregex_nodes: []\n"
        config_path = _make_project(root, manifest_yaml)
        before = (root / "project.precis.yaml").read_text(encoding="utf-8")

        schema_file = root / "schemas" / "orphan.schema.yaml"
        schema_file.parent.mkdir()
        schema_file.write_text("id: orphan\n", encoding="utf-8")

        result = delete_v2_schema("orphan", config_path=config_path)
        assert "已删除" in result["message"]
        assert not schema_file.exists()
        # manifest 无该引用，无需写回
        assert (root / "project.precis.yaml").read_text(encoding="utf-8") == before


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
