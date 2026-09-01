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
        prompt, _ = build_prompt([], "电商数据校验")
        assert "电商数据校验" in prompt

    def test_contains_table_name(self):
        prompt, _ = build_prompt([_make_profiling_item()], "Test")
        assert "users" in prompt

    def test_contains_file_path(self):
        prompt, _ = build_prompt([_make_profiling_item()], "Test")
        assert "data/users.csv" in prompt

    def test_contains_sheet_name(self):
        prompt, _ = build_prompt([_make_profiling_item(sheet_name="Sheet1")], "Test")
        assert "Sheet: Sheet1" in prompt

    def test_omits_sheet_when_absent(self):
        prompt, _ = build_prompt([_make_profiling_item()], "Test")
        assert "Sheet:" not in prompt

    def test_contains_column_info(self):
        prompt, _ = build_prompt([_make_profiling_item()], "Test")
        assert "id" in prompt
        assert "email" in prompt

    def test_truncates_columns_beyond_limit(self):
        columns = [{"name": f"col_{i}", "dtype": "int64", "null_count": 0} for i in range(25)]
        prompt, _ = build_prompt([_make_profiling_item(columns=columns)], "Test")
        assert "还有 5 列未显示" in prompt

    def test_empty_profiling_data(self):
        prompt, _ = build_prompt([], "Test")
        assert "输出要求" in prompt

    def test_contains_json_format_instruction(self):
        prompt, _ = build_prompt([], "Test")
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
        prompt, _ = build_prompt([_make_profiling_item(columns=columns)], "Test")
        assert "例:" in prompt

    def test_file_truncation_warns_with_total_count(self):
        """超预算截断文件数时必须发出警告，且总数为截断前的文件数。

        缺陷：旧实现先切片再取 len，omitted 恒为 0，超预算文件被静默丢弃无警告。
        """
        files = [
            _make_profiling_item(
                table_name=f"table_{i}",
                path=f"data/table_{i}.csv",
                columns=[
                    {"name": f"col_{j}", "dtype": "int64", "null_count": 0, "sample_values": ["value"]}
                    for j in range(10)
                ],
            )
            for i in range(4)
        ]
        prompt, warnings = build_prompt(files, "Test", max_prompt_chars=500)

        # 必须发出截断警告，且总数为截断前的 4 个
        truncation_warnings = [w for w in warnings if "数据文件过多" in w]
        assert truncation_warnings, f"应有文件截断警告，实际 warnings={warnings}"
        assert "共 4 个" in truncation_warnings[0]
        assert "仅分析前" in truncation_warnings[0]
        # 截断生效：只保留前 N 个文件
        assert "table_0" in prompt
        assert "table_3" not in prompt
