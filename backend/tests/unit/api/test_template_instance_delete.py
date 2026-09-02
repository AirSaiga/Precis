"""template_instance 引用删除链测试。

覆盖 2026-09-02 风险扫描坐实的"幽灵复活"缺陷修复：
- 全量保存对空 template_instances 列表采取"视为未携带、从磁盘合并"防御（防清单
  误清空），导致"删光实例 → 保存 → 重载"会从磁盘合并出已删引用——删除实例必须
  走专用 DELETE 端点同步清引用。
- DELETE /template/{id} 此前不级联清理指向它的实例引用，留下永久悬空引用
  （每次加载产生 TemplateInstanceMissingTemplate 错误）。
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi import HTTPException

from app.api.routers.project.full_config import get_v2_full_config
from app.api.routers.project.full_config_writer import write_v2_full_config
from app.api.routers.project.manifest import delete_manifest_template_instance_ref
from app.api.routers.project.models import FullConfigV2Request
from app.api.routers.project.template import delete_template
from app.shared.core.project.manifest.types import ProjectInfoV2, ProjectManifestV2


def _write_manifest(root: Path, data: dict) -> str:
    root.mkdir(parents=True, exist_ok=True)
    (root / "project.precis.yaml").write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return str(root)


def _read_manifest(root: Path) -> dict:
    return yaml.safe_load((root / "project.precis.yaml").read_text(encoding="utf-8"))


def _manifest_with_instances(instances: list[dict]) -> dict:
    return {
        "version": 2,
        "project": {"id": "p", "name": "p"},
        "schemas": [],
        "constraints": [],
        "regex_nodes": [],
        "template_instances": instances,
    }


class TestDeleteTemplateInstanceRef:
    def test_delete_removes_target_ref_and_keeps_others(self, tmp_path):
        config_path = _write_manifest(
            tmp_path,
            _manifest_with_instances(
                [
                    {"id": "inst-1", "template_id": "t1", "enabled": True},
                    {"id": "inst-2", "template_id": "t2", "enabled": False},
                ]
            ),
        )

        result = delete_manifest_template_instance_ref("inst-1", config_path)

        assert "已删除" in result["message"]
        remaining = _read_manifest(tmp_path)["template_instances"]
        assert [item["id"] for item in remaining] == ["inst-2"]

    def test_delete_is_idempotent_when_ref_absent(self, tmp_path):
        config_path = _write_manifest(
            tmp_path,
            _manifest_with_instances([{"id": "inst-1", "template_id": "t1", "enabled": True}]),
        )

        result = delete_manifest_template_instance_ref("no-such", config_path)

        assert "不存在" in result["message"]
        assert [item["id"] for item in _read_manifest(tmp_path)["template_instances"]] == ["inst-1"]

    def test_delete_raises_404_when_manifest_missing(self, tmp_path):
        tmp_path.mkdir(parents=True, exist_ok=True)
        with pytest.raises(HTTPException) as exc_info:
            delete_manifest_template_instance_ref("inst-1", str(tmp_path))
        assert exc_info.value.status_code == 404

    def test_full_save_after_delete_no_ghost_resurrection(self, tmp_path):
        """回归核心场景：删光实例 → 全量保存（payload 不携带该字段）→ 重载不再复活。

        修复前：DELETE 端点不存在，磁盘引用只能靠全量保存清——而空列表防御
        会把旧引用合并回来，get_v2_full_config 原样返回已删实例。
        """
        config_path = _write_manifest(
            tmp_path,
            _manifest_with_instances([{"id": "inst-1", "template_id": "t1", "enabled": True}]),
        )
        delete_manifest_template_instance_ref("inst-1", config_path)

        # 模拟前端"画布已无实例"的全量保存（planBuilder 对空 Map 不携带该字段）
        payload = FullConfigV2Request(
            manifest=ProjectManifestV2(
                version=2,
                project=ProjectInfoV2(id="p", name="p"),
                schemas=[],
                constraints=[],
                regex_nodes=[],
            ),
            schemas={},
            constraints={},
            regex_nodes={},
        )
        write_v2_full_config(payload, config_path)

        loaded = get_v2_full_config(config_path, inspect=False)
        assert not loaded["manifest"].get("template_instances")


class TestDeleteTemplateCascade:
    def test_delete_template_cascades_instance_refs(self, tmp_path):
        (tmp_path / "templates").mkdir()
        template_file = tmp_path / "templates" / "t1.template.yaml"
        template_file.write_text("version: 2\nid: t1\nname: t\nnodes: []\n", encoding="utf-8")
        config_path = _write_manifest(
            tmp_path,
            {
                "version": 2,
                "project": {"id": "p", "name": "p"},
                "schemas": [],
                "constraints": [],
                "regex_nodes": [],
                "templates": [{"id": "t1", "path": "templates/t1.template.yaml"}],
                "template_instances": [
                    {"id": "inst-1", "template_id": "t1", "enabled": True},
                    {"id": "inst-2", "template_id": "t1", "enabled": True},
                    {"id": "inst-3", "template_id": "t-other", "enabled": True},
                ],
            },
        )

        result = delete_template("t1", config_path)

        assert result.success is True
        assert not template_file.exists()
        manifest = _read_manifest(tmp_path)
        assert manifest["templates"] == []
        # 指向 t1 的实例引用随定义级联清理；其他模板的实例保留
        assert [item["id"] for item in manifest["template_instances"]] == ["inst-3"]
