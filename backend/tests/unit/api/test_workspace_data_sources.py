"""@fileoverview 工作区 data_sources API 项目根语义测试

覆盖 B-fix: X-Project-Config-Path header 即项目根（含 project.precis.yaml，
见 dependencies._validate_project_root 的 B-sec3 加固）。

此前 _get_project_root 误取 config_path 的 parent，导致 data_sources.yaml 被写到
项目父目录的 .precis/ 下——同一父目录下的多个项目会互相覆盖数据源配置。
修复后 header 原样作为项目根使用，data_sources.yaml 落在 项目根/.precis/ 下。
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers.core.data_sources import _get_project_root
from app.api.routers.core.data_sources import router as workspace_router


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(workspace_router)
    return app


def test_get_project_root_returns_config_path_as_is():
    """_get_project_root 不应再取 parent：header 传入的项目根原样返回。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        assert _get_project_root(tmpdir) == tmpdir


def test_data_sources_yaml_lands_in_project_root_precis_dir():
    """header=项目根时 data_sources.yaml 落在 项目根/.precis/ 下，而非项目父目录。"""
    with tempfile.TemporaryDirectory() as parent:
        root = Path(parent) / "proj-a"
        root.mkdir()
        (root / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")

        client = TestClient(_app())
        resp = client.put(
            "/api/latest/workspace/config",
            json={"version": "1.0", "data_sources": [{"id": "ds1", "name": "用户表", "type": "excel"}]},
            headers={"X-Project-Config-Path": str(root)},
        )
        assert resp.status_code == 200

        # 写入位置：项目根/.precis/data_sources.yaml
        assert (root / ".precis" / "data_sources.yaml").is_file()
        # 关键回归：不得写入项目父目录的 .precis/（否则同目录多项目互覆）
        assert not (Path(parent) / ".precis" / "data_sources.yaml").exists()

        # GET roundtrip：保存的数据源可读回
        resp2 = client.get("/api/latest/workspace/config", headers={"X-Project-Config-Path": str(root)})
        assert resp2.status_code == 200
        ids = [ds["id"] for ds in resp2.json()["data_sources"]]
        assert "ds1" in ids


def test_sibling_projects_do_not_share_data_sources_file():
    """同父目录的两个项目各自持有独立 data_sources.yaml，互不覆盖。"""
    with tempfile.TemporaryDirectory() as parent:
        proj_a = Path(parent) / "proj-a"
        proj_b = Path(parent) / "proj-b"
        for proj in (proj_a, proj_b):
            proj.mkdir()
            (proj / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")

        client = TestClient(_app())
        headers_a = {"X-Project-Config-Path": str(proj_a)}
        headers_b = {"X-Project-Config-Path": str(proj_b)}

        resp_a = client.put(
            "/api/latest/workspace/config",
            json={"version": "1.0", "data_sources": [{"id": "only-a", "name": "A 的数据源", "type": "excel"}]},
            headers=headers_a,
        )
        assert resp_a.status_code == 200

        # 项目 A 的数据源不应"泄漏"进项目 B（修复前共享父目录 .precis/ 会互覆）
        resp_b = client.get("/api/latest/workspace/config", headers=headers_b)
        assert resp_b.status_code == 200
        assert resp_b.json()["data_sources"] == []


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
