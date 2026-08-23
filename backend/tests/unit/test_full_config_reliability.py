"""full_config 可靠性加固测试。

覆盖三项 B-reliability 修复：
- C2: GET /config/full 对 regex/transform/manual_data 坏引用容错（不 500）
- C3: PUT /config/full 在 manifest 损坏时拒绝写入（不带空基准覆盖）
- C4: settings 未显式设置时保留磁盘值（防静默回滚）
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import yaml

from app.api.routers.project.full_config import get_v2_full_config
from app.api.routers.project.full_config_writer import write_v2_full_config
from app.api.routers.project.models import FullConfigV2Request
from app.shared.core.project.manifest.types import (
    ProjectInfoV2,
    ProjectManifestV2,
    ProjectSettingsV2,
)


def _make_project(tmpdir: str) -> Path:
    root = Path(tmpdir)
    (root / "project.precis.yaml").write_text(
        "version: 2\nproject:\n  id: p\n  name: p\nschemas: []\nconstraints: []\nregex_nodes: []\n",
        encoding="utf-8",
    )
    return root


def _minimal_manifest() -> ProjectManifestV2:
    return ProjectManifestV2(
        version=2,
        project=ProjectInfoV2(id="p", name="p"),
        schemas=[],
        constraints=[],
        regex_nodes=[],
    )


class TestFullConfigReliabilityHardening:
    def test_get_full_config_with_bad_regex_ref_returns_200(self):
        """C2: manifest 含单条坏引用(含 ..)时不应 500,应跳过该条并正常返回"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "schemas: []\n"
                "constraints: []\n"
                'regex_nodes:\n  - id: evil\n    path: "../../outside.regex.yaml"\n',
                encoding="utf-8",
            )
            result = get_v2_full_config(str(root), inspect=False)
            assert result["regex_nodes"] == {}
            assert result["manifest"]["project"]["id"] == "p"

    def test_get_full_config_with_bad_transform_ref_returns_200(self):
        """C2: transform 坏引用同样跳过,不阻断接口"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "schemas: []\n"
                "constraints: []\n"
                "regex_nodes: []\n"
                'transforms:\n  - id: evil\n    path: "../escape.transform.yaml"\n',
                encoding="utf-8",
            )
            result = get_v2_full_config(str(root), inspect=False)
            assert result["transforms"] == {}

    def test_get_full_config_includes_template_content(self):
        """templates 内容字典: 正常模板按 id 索引返回完整内容(含 name),供前端资源树/检查器使用"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            (root / "templates").mkdir()
            (root / "templates" / "my_tmpl.template.yaml").write_text(
                "version: 2\nid: my_tmpl\nname: 我的模板\ndescription: 测试用\nnodes: []\n",
                encoding="utf-8",
            )
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "schemas: []\n"
                "constraints: []\n"
                "regex_nodes: []\n"
                "templates:\n  - id: my_tmpl\n    path: templates/my_tmpl.template.yaml\n",
                encoding="utf-8",
            )
            result = get_v2_full_config(str(root), inspect=False)
            assert result["templates"]["my_tmpl"]["name"] == "我的模板"
            assert result["templates"]["my_tmpl"]["id"] == "my_tmpl"

    def test_get_full_config_with_bad_template_ref_returns_200(self):
        """templates 坏引用与 regex/transform 同样容错: 跳过该条,不 500"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "schemas: []\n"
                "constraints: []\n"
                "regex_nodes: []\n"
                'templates:\n  - id: evil\n    path: "../../outside.template.yaml"\n',
                encoding="utf-8",
            )
            result = get_v2_full_config(str(root), inspect=False)
            assert result["templates"] == {}

    def test_get_full_config_with_broken_template_file_returns_200(self):
        """模板文件本身损坏: 记日志跳过,接口仍正常返回其余资源"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            (root / "templates").mkdir()
            (root / "templates" / "bad.template.yaml").write_text(
                "version: 2\nid: bad\nname: [unclosed\n",
                encoding="utf-8",
            )
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "schemas: []\n"
                "constraints: []\n"
                "regex_nodes: []\n"
                "templates:\n  - id: bad\n    path: templates/bad.template.yaml\n",
                encoding="utf-8",
            )
            result = get_v2_full_config(str(root), inspect=False)
            assert result["templates"] == {}
            assert result["manifest"]["project"]["id"] == "p"

    def test_write_full_config_corrupted_manifest_rejected(self):
        """C3: manifest 已存在但损坏时拒绝写入,磁盘内容保持不变"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            broken = "version: 2\nproject: [unclosed"
            (root / "project.precis.yaml").write_text(broken, encoding="utf-8")

            payload = FullConfigV2Request(manifest=_minimal_manifest())
            with pytest.raises(Exception, match="拒绝本次写入"):
                write_v2_full_config(payload, tmpdir)
            assert (root / "project.precis.yaml").read_text(encoding="utf-8") == broken

    def test_write_full_config_preserves_settings_when_not_set(self):
        """C4: payload 未显式设置 settings 时保留磁盘上的用户设置"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "settings:\n"
                "  validation: {timeout_seconds: 99}\n"
                "  file_processing: {csv_delimiter: ';'}\n"
                "schemas: []\n"
                "constraints: []\n"
                "regex_nodes: []\n",
                encoding="utf-8",
            )
            manifest = _minimal_manifest()
            assert "settings" not in manifest.model_fields_set
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            assert saved["settings"]["file_processing"]["csv_delimiter"] == ";"
            assert saved["settings"]["validation"]["timeout_seconds"] == 99

    def test_write_full_config_explicit_settings_still_applied(self):
        """C4 对照: payload 显式设置 settings 时遵从客户端意图(允许改设置)"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = _make_project(tmpdir)
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="p", name="p"),
                settings=ProjectSettingsV2(),
                schemas=[],
                constraints=[],
                regex_nodes=[],
            )
            assert "settings" in manifest.model_fields_set
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            assert "settings" in saved  # 显式设置被写入


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
