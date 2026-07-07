"""shared_services.project_ops 单元测试。"""

from __future__ import annotations

from app.cli.shared_services import project_ops


def test_history_dedup_and_cap(monkeypatch, tmp_path):
    """去重 + MAX_HISTORY=10 容量上限。"""
    hist_file = tmp_path / "history.json"
    monkeypatch.setattr(project_ops, "HISTORY_FILE", str(hist_file))
    for i in range(12):
        project_ops.add_to_history(f"/proj{i}")
    history = project_ops.load_history()
    assert len(history) == 10
    assert history[0]["path"] == "/proj11"  # 最新的在顶部
    # 去重：再添加已存在的路径
    project_ops.add_to_history("/proj11")
    assert len(project_ops.load_history()) == 10
    assert project_ops.load_history()[0]["path"] == "/proj11"


def test_open_project_loads_manifest(monkeypatch, tmp_path):
    """打开有清单的项目应加载 manifest 配置。"""
    # 隔离历史文件，避免污染真实 ~/.precis_project_history
    monkeypatch.setattr(project_ops, "HISTORY_FILE", str(tmp_path / "history.json"))
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "project.precis.yaml").write_text("version: 2\nproject: {id: x, name: TestProj}\n", encoding="utf-8")
    result = project_ops.open_project(str(proj))
    assert result.success
    assert result.config["project"]["name"] == "TestProj"


def test_resolve_project_label_falls_back_to_dirname(tmp_path):
    """无 manifest 时用目录名作为项目显示名。"""
    proj = tmp_path / "myproj"
    proj.mkdir()
    # 无 manifest → 用目录名
    assert project_ops.resolve_project_label(str(proj)) == "myproj"
