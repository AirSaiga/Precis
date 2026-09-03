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
from app.shared.core.project.manifest.types_parts.template import TemplateRef


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

    def test_write_full_config_preserves_templates_when_not_set(self):
        """B-fix(templates): PUT 全量保存不含 templates 字段时，现有 templates/template_instances 保留。

        此前合并分支缺失这两个字段——"另存为模板"后下一次前端全量保存（payload 不带
        templates 字段）会把 manifest.templates 静默清空。
        回归(2026-09)：保留现已并入统一 model_fields_set 防线（_validate_unique_ids 已改
        object.__setattr__ 不再污染 fields_set），与 schemas 等字段同一判定，原"空列表=未携带"
        启发式已退役。
        """
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
                "templates:\n"
                "  - id: my_tmpl\n"
                "    path: templates/my_tmpl.template.yaml\n"
                "template_instances:\n"
                "  - id: inst_1\n"
                "    template_id: my_tmpl\n"
                "    enabled: true\n",
                encoding="utf-8",
            )
            # 模拟前端全量保存 payload：不含 templates / template_instances 字段
            manifest = _minimal_manifest()
            assert manifest.templates == []
            assert manifest.template_instances == []
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            assert saved["templates"] == [{"id": "my_tmpl", "path": "templates/my_tmpl.template.yaml"}]
            assert saved["template_instances"][0]["id"] == "inst_1"
            assert saved["template_instances"][0]["template_id"] == "my_tmpl"

    def test_write_full_config_with_templates_content_still_applied(self):
        """对照: payload 携带非空 templates 时遵从客户端数据，不被磁盘值覆盖。"""
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
                "templates:\n"
                "  - id: disk_tmpl\n"
                "    path: templates/disk_tmpl.template.yaml\n",
                encoding="utf-8",
            )
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="p", name="p"),
                templates=[TemplateRef(id="fresh_tmpl", path="templates/fresh_tmpl.template.yaml")],
                schemas=[],
                constraints=[],
                regex_nodes=[],
            )
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            assert saved["templates"] == [{"id": "fresh_tmpl", "path": "templates/fresh_tmpl.template.yaml"}]

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


class TestFieldsSetPurityAndMergeRevival:
    """回归(2026-09)：fields_set 纯净性守卫 + 合并/扫描防线复活。

    缺陷史：_validate_unique_ids（mode="after"）曾用普通赋值就地重写全部列表字段，
    Pydantic v2 会把被赋值字段加入 model_fields_set，导致 PUT /config/full 的
    "未显式设置则保留磁盘值"防线对全部列表字段失效（最小 PUT 即清空磁盘引用），
    仅 templates/template_instances 靠空列表启发式幸免。修复=校验器内改用
    object.__setattr__；本类测试防止该形态复发。
    """

    _LIST_FIELDS = (
        "schemas",
        "constraints",
        "regex_nodes",
        "transforms",
        "manual_data",
        "data_sources",
        "templates",
        "template_instances",
    )

    def test_fields_set_purity_no_validator_pollution(self):
        """纯净性守卫：fields_set 只含客户端输入键，校验器赋值不得引入额外字段"""
        m = ProjectManifestV2.model_validate({"version": 2, "project": {"id": "p", "name": "n"}})
        assert m.model_fields_set == {"version", "project"}

        # 构造器 kwargs 同样视为"显式输入"
        m2 = ProjectManifestV2(
            version=2,
            project=ProjectInfoV2(id="p", name="p"),
            schemas=[],
            constraints=[],
            regex_nodes=[],
        )
        assert "schemas" in m2.model_fields_set
        assert "templates" not in m2.model_fields_set
        assert "settings" not in m2.model_fields_set

    def _disk_manifest(self) -> str:
        """磁盘现状：8 类引用各 1 条"""
        return (
            "version: 2\n"
            "project:\n"
            "  id: p\n"
            "  name: p\n"
            "schemas:\n"
            "  - id: s_disk\n"
            "    path: schemas/s_disk.schema.yaml\n"
            "constraints:\n"
            "  - id: c_disk\n"
            "    path: constraints/c_disk.constraint.yaml\n"
            "regex_nodes:\n"
            "  - id: r_disk\n"
            "    path: regex/r_disk.regex.yaml\n"
            "transforms:\n"
            "  - id: t_disk\n"
            "    path: transforms/t_disk.transform.yaml\n"
            "manual_data:\n"
            "  - id: m_disk\n"
            "    path: manual_data/m_disk.manual_data.yaml\n"
            "data_sources:\n"
            "  - id: main\n"
            "    path: data\n"
            "    mode: relative\n"
            "templates:\n"
            "  - id: tpl_disk\n"
            "    path: templates/tpl_disk.template.yaml\n"
            "template_instances:\n"
            "  - id: inst_disk\n"
            "    template_id: tpl_disk\n"
            "    enabled: true\n"
        )

    def test_minimal_put_preserves_all_disk_references(self):
        """核心防线复活：payload 缺省全部列表字段（仅带 project）→ 磁盘引用全部保留。

        缺陷期行为：schemas/constraints/regex_nodes/transforms/manual_data/data_sources
        被清空（data_sources 无扫描兜底，受损最重）。
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "project.precis.yaml").write_text(self._disk_manifest(), encoding="utf-8")
            manifest = ProjectManifestV2(version=2, project=ProjectInfoV2(id="p", name="p"))
            assert set(self._LIST_FIELDS).isdisjoint(manifest.model_fields_set)
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            for field in self._LIST_FIELDS:
                refs = saved.get(field) or []
                assert len(refs) == 1, f"{field} 引用被清空：{refs}"

    def test_directory_scan_revives_for_empty_existing(self):
        """扫描防线复活：existing 与 payload 均未提供 schemas，但磁盘 schemas/ 目录有文件 → 自动发现"""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "schemas").mkdir()
            (root / "schemas" / "scanned.schema.yaml").write_text(
                "version: 2\nid: scanned\nname: scanned\ncolumns: []\n", encoding="utf-8"
            )
            (root / "project.precis.yaml").write_text(
                "version: 2\nproject:\n  id: p\n  name: p\nschemas: []\nconstraints: []\nregex_nodes: []\n",
                encoding="utf-8",
            )
            manifest = ProjectManifestV2(version=2, project=ProjectInfoV2(id="p", name="p"))
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            assert saved["schemas"] == [{"id": "scanned", "path": "schemas/scanned.schema.yaml"}]

    def test_explicit_empty_templates_now_clears_disk_value(self):
        """语义统一：payload 显式 templates: [] → 遵从清空意图（旧启发式强制保留）。

        与 schemas/constraints 的既定语义对齐；清空应走模板专用端点的场景由前端保证。
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "project.precis.yaml").write_text(
                "version: 2\n"
                "project:\n"
                "  id: p\n"
                "  name: p\n"
                "schemas: []\n"
                "constraints: []\n"
                "regex_nodes: []\n"
                "templates:\n"
                "  - id: disk_tmpl\n"
                "    path: templates/disk_tmpl.template.yaml\n",
                encoding="utf-8",
            )
            manifest = ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="p", name="p"),
                templates=[],
                schemas=[],
                constraints=[],
                regex_nodes=[],
            )
            write_v2_full_config(FullConfigV2Request(manifest=manifest), tmpdir)

            saved = yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))
            assert saved.get("templates") in ([], None)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
