"""@fileoverview view/workspaces JSON 原子写测试

覆盖 B-reliability 修复: project.view.json 与 workspaces.json 属于高频覆写文件，
此前用裸 open("w") 直写，进程中断会留下半个 JSON 导致下次读取 500。
修复后统一走"临时文件 + os.replace"的原子写。
"""

from __future__ import annotations

import json

import pytest

from app.api.routers.project import view as view_module
from app.api.routers.project import workspaces as ws_module
from app.api.routers.project.models import ProjectViewV2Model, WorkspacesV2Model

# 两个路由各自持有同语义的原子写小工具，行为必须一致（参数化统一验证）
ATOMIC_WRITE_FNS = [
    pytest.param(view_module._write_json_atomic, id="view"),
    pytest.param(ws_module._write_json_atomic, id="workspaces"),
]


class TestWriteJsonAtomic:
    @pytest.mark.parametrize("write_fn", ATOMIC_WRITE_FNS)
    def test_writes_valid_json_with_unicode(self, tmp_path, write_fn):
        target = tmp_path / "data.json"
        write_fn(str(target), {"hello": "你好", "n": 1})
        assert json.loads(target.read_text(encoding="utf-8")) == {"hello": "你好", "n": 1}

    @pytest.mark.parametrize("write_fn", ATOMIC_WRITE_FNS)
    def test_no_tmp_leftover_after_success(self, tmp_path, write_fn):
        target = tmp_path / "data.json"
        write_fn(str(target), {"a": 1})
        leftovers = [p.name for p in tmp_path.iterdir() if p.name != "data.json"]
        assert leftovers == []

    @pytest.mark.parametrize("write_fn", ATOMIC_WRITE_FNS)
    def test_replaces_existing_content(self, tmp_path, write_fn):
        target = tmp_path / "data.json"
        target.write_text('{"old": true}', encoding="utf-8")
        write_fn(str(target), {"new": True})
        assert json.loads(target.read_text(encoding="utf-8")) == {"new": True}

    @pytest.mark.parametrize("write_fn", ATOMIC_WRITE_FNS)
    def test_failure_keeps_old_content_and_cleans_tmp(self, tmp_path, write_fn, monkeypatch):
        """序列化中途失败：原文件不被破坏（原子性语义），临时文件被清理。"""
        target = tmp_path / "data.json"
        target.write_text('{"old": true}', encoding="utf-8")

        def boom(*args, **kwargs):
            raise RuntimeError("disk full")

        monkeypatch.setattr(json, "dump", boom)
        with pytest.raises(RuntimeError, match="disk full"):
            write_fn(str(target), {"new": True})

        assert json.loads(target.read_text(encoding="utf-8")) == {"old": True}
        leftovers = [p.name for p in tmp_path.iterdir() if p.name != "data.json"]
        assert leftovers == []


class TestViewWorkspacesEndpointsAtomicWrite:
    def test_put_view_writes_readable_json(self, tmp_path):
        payload = ProjectViewV2Model(version=1, nodes={"n1": {"x": 10.0, "y": 20.0}})
        resp = view_module.put_v2_project_view(payload, config_path=str(tmp_path))

        assert resp.message == "Project view saved"
        view_file = tmp_path / "project.view.json"
        assert view_file.is_file()
        data = json.loads(view_file.read_text(encoding="utf-8"))
        assert data["nodes"]["n1"]["x"] == 10.0

    def test_put_workspaces_writes_readable_json(self, tmp_path):
        payload = WorkspacesV2Model(version=1, activeWorkspaceId="w1", workspaces=[])
        resp = ws_module.put_v2_workspaces(payload, config_path=str(tmp_path))

        assert resp.message == "Workspaces saved"
        ws_file = tmp_path / ".precis" / "workspaces.json"
        assert ws_file.is_file()
        data = json.loads(ws_file.read_text(encoding="utf-8"))
        assert data["activeWorkspaceId"] == "w1"

    def test_put_view_roundtrip(self, tmp_path):
        """PUT 后 GET 能读回相同视图（写入的是合法 JSON）。"""
        payload = ProjectViewV2Model(version=1, nodes={"n1": {"x": 1.0, "y": 2.0}})
        view_module.put_v2_project_view(payload, config_path=str(tmp_path))
        loaded = view_module.get_v2_project_view(config_path=str(tmp_path))
        assert loaded.nodes == {"n1": {"x": 1.0, "y": 2.0}}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
