"""@fileoverview GET /manifest 端点健壮性测试

覆盖 B-fix: project.precis.yaml 为空/损坏时，ProjectManifestV2.model_validate
此前抛裸 ValidationError → 无 detail 的 500。修复后捕获并返回带中文说明的 422，
前端可据此提示用户修复或回退清单文件。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.routers.project.manifest import get_v2_manifest


def _write_manifest(root: Path, content: str) -> str:
    root.mkdir(parents=True, exist_ok=True)
    (root / "project.precis.yaml").write_text(content, encoding="utf-8")
    return str(root)


def test_missing_manifest_returns_404(tmp_path):
    """清单文件不存在 → 404（原有行为不变）。"""
    tmp_path.mkdir(parents=True, exist_ok=True)
    with pytest.raises(HTTPException) as exc_info:
        get_v2_manifest(str(tmp_path))
    assert exc_info.value.status_code == 404


def test_empty_manifest_returns_422_with_detail(tmp_path):
    """清单文件为空 → 422 + 中文说明（此前为无 detail 的 500）。"""
    config_path = _write_manifest(tmp_path, "")
    with pytest.raises(HTTPException) as exc_info:
        get_v2_manifest(config_path)
    assert exc_info.value.status_code == 422
    assert "损坏或为空" in exc_info.value.detail


def test_corrupt_yaml_manifest_returns_422_with_detail(tmp_path):
    """YAML 语法损坏 → 422 + 中文说明。"""
    config_path = _write_manifest(tmp_path, "version: 2\nproject: [unclosed")
    with pytest.raises(HTTPException) as exc_info:
        get_v2_manifest(config_path)
    assert exc_info.value.status_code == 422
    assert "损坏或为空" in exc_info.value.detail


def test_invalid_manifest_shape_returns_422_with_detail(tmp_path):
    """YAML 合法但字段类型不符（ValidationError）→ 422 + 中文说明。"""
    config_path = _write_manifest(
        tmp_path,
        "version: 2\nproject:\n  id: p\n  name: p\nschemas: not-a-list\n",
    )
    with pytest.raises(HTTPException) as exc_info:
        get_v2_manifest(config_path)
    assert exc_info.value.status_code == 422
    assert "损坏或为空" in exc_info.value.detail


def test_valid_manifest_returns_model(tmp_path):
    """对照: 合法清单正常解析（修复不影响正常路径）。"""
    config_path = _write_manifest(
        tmp_path,
        "version: 2\nproject:\n  id: p\n  name: p\nschemas: []\nconstraints: []\nregex_nodes: []\n",
    )
    manifest = get_v2_manifest(config_path)
    assert manifest.project.id == "p"
    assert manifest.schemas == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
