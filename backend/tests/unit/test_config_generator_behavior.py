"""
@fileoverview V2 配置生成器辅助函数行为测试

覆盖 expand_data_input_paths 与 profile_files。
"""

from __future__ import annotations

from app.shared.services.llm.config_generator import expand_data_input_paths, profile_files


class TestExpandDataInputPaths:
    """expand_data_input_paths 行为"""

    def test_keeps_files(self, tmp_path):
        csv = tmp_path / "a.csv"
        csv.write_text("a,b\n1,2\n", encoding="utf-8")
        result = expand_data_input_paths([str(csv)])
        assert result == [str(csv)]

    def test_expands_directory(self, tmp_path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "a.csv").write_text("a\n1\n", encoding="utf-8")
        (sub / "b.txt").write_text("x", encoding="utf-8")
        result = expand_data_input_paths([str(sub)])
        assert len(result) == 1
        assert result[0].endswith("a.csv")

    def test_skips_nonexistent(self):
        result = expand_data_input_paths(["/nonexistent/path"])
        assert result == []

    def test_empty_list(self):
        assert expand_data_input_paths([]) == []


class TestProfileFiles:
    """profile_files 行为"""

    def test_profiles_existing_files(self, tmp_path):
        csv = tmp_path / "test.csv"
        csv.write_text("a,b\n1,2\n", encoding="utf-8")
        result = profile_files([str(csv)])
        assert result["total_count"] == 1
        assert result["files"][0]["extension"] == ".csv"
        assert result["files"][0]["size"] > 0

    def test_skips_nonexistent_files(self):
        result = profile_files(["/nonexistent/file.csv"])
        assert result["total_count"] == 0
        assert result["files"] == []
