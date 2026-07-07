"""shared_services.generation_ops 单元测试。"""

from __future__ import annotations

from app.cli.shared_services.generation_ops import apply_generated_config, scan_data_files


def test_apply_generated_config_writes_files(tmp_path):
    result = {
        "manifest": {"version": 2, "project": {"id": "t", "name": "T"}},
        "schemas": {"s1": {"columns": []}},
        "constraints": {"c1": {"type": "not_null"}},
        "regex_nodes": {},
    }
    written = apply_generated_config(result, str(tmp_path))
    assert "project.precis.yaml" in written
    assert "schemas/s1.schema.yaml" in written
    assert "constraints/c1.constraint.yaml" in written
    assert (tmp_path / "schemas" / "s1.schema.yaml").exists()


def test_scan_data_files_scans_data_dir(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "a.xlsx").write_text("x")
    (data_dir / "b.txt").write_text("y")  # 不支持的扩展名
    files = scan_data_files([], str(tmp_path))
    assert any("a.xlsx" in f for f in files)
    assert not any("b.txt" in f for f in files)
