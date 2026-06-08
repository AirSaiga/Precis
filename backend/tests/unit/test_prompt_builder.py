"""@fileoverview prompt_builder 单元测试

覆盖 build_prompt 的提示词构建逻辑。
"""

from __future__ import annotations

from app.shared.services.llm.generation.prompt_builder import build_prompt


def _make_profiling_item(
    table_name="users",
    path="data/users.csv",
    sheet_name=None,
    columns=None,
):
    item = {"table_name": table_name, "path": path}
    if sheet_name:
        item["sheet_name"] = sheet_name
    if columns is not None:
        item["columns"] = columns
    else:
        item["columns"] = [
            {"name": "id", "dtype": "int64", "null_count": 0, "sample_values": [1, 2]},
            {"name": "email", "dtype": "object", "null_count": 0, "sample_values": ["a@b.com"]},
        ]
    return item


class TestBuildPrompt:
    def test_contains_project_name(self):
        prompt = build_prompt([], "电商数据校验")
        assert "电商数据校验" in prompt

    def test_contains_table_name(self):
        prompt = build_prompt([_make_profiling_item()], "Test")
        assert "users" in prompt

    def test_contains_file_path(self):
        prompt = build_prompt([_make_profiling_item()], "Test")
        assert "data/users.csv" in prompt

    def test_contains_sheet_name(self):
        prompt = build_prompt(
            [_make_profiling_item(sheet_name="Sheet1")], "Test"
        )
        assert "Sheet: Sheet1" in prompt

    def test_omits_sheet_when_absent(self):
        prompt = build_prompt([_make_profiling_item()], "Test")
        assert "Sheet:" not in prompt

    def test_contains_column_info(self):
        prompt = build_prompt([_make_profiling_item()], "Test")
        assert "id" in prompt
        assert "email" in prompt

    def test_truncates_columns_beyond_limit(self):
        columns = [{"name": f"col_{i}", "dtype": "int64", "null_count": 0} for i in range(25)]
        prompt = build_prompt(
            [_make_profiling_item(columns=columns)], "Test"
        )
        assert "还有 5 列未显示" in prompt

    def test_empty_profiling_data(self):
        prompt = build_prompt([], "Test")
        assert "输出要求" in prompt

    def test_contains_json_format_instruction(self):
        prompt = build_prompt([], "Test")
        assert "JSON" in prompt
        assert "schemas" in prompt
        assert "constraints" in prompt

    def test_sample_values_truncated(self):
        columns = [
            {
                "name": "desc",
                "dtype": "object",
                "null_count": 0,
                "sample_values": ["a" * 100],
            }
        ]
        prompt = build_prompt(
            [_make_profiling_item(columns=columns)], "Test"
        )
        assert "例:" in prompt
