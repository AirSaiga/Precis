"""@fileoverview AI 执行结果展示模块的单元测试

覆盖范围：
- _format_validate_table_display：根据 table_filter 推导展示文案的纯函数

测试策略：纯逻辑函数，无 IO 依赖，直接断言输入→输出映射。
重点回归：全量校验（table_filter=None）时不得显示字面量"指定表"。
"""

from __future__ import annotations

from app.cli.shell.commands.ai.display import _format_validate_table_display


class TestFormatValidateTableDisplay:
    """_format_validate_table_display 的输入→输出映射测试。"""

    def test_none_returns_all_tables(self):
        """全量校验（table_filter=None）应显示"全部表"，而非历史上的字面量"指定表"。"""
        assert _format_validate_table_display(None) == "全部表"

    def test_empty_string_returns_all_tables(self):
        """空字符串视为全量校验。"""
        assert _format_validate_table_display("") == "全部表"

    def test_empty_list_returns_all_tables(self):
        """空列表视为全量校验。"""
        assert _format_validate_table_display([]) == "全部表"

    def test_string_returns_single_table_name(self):
        """字符串形式 → 直接返回该表名。"""
        assert _format_validate_table_display("users") == "users"

    def test_single_element_list_returns_table_name(self):
        """单元素列表 → 返回该表名（不附带"1 张表"前缀）。"""
        assert _format_validate_table_display(["users"]) == "users"

    def test_multi_element_list_returns_count_and_names(self):
        """多元素列表 → 返回"N 张表（t1, t2）"格式。"""
        result = _format_validate_table_display(["users", "orders"])
        assert result == "2 张表（users, orders）"

    def test_list_with_empty_strings_filters_them_out(self):
        """列表中的空字符串应被过滤掉，不参与计数。"""
        assert _format_validate_table_display(["users", ""]) == "users"

    def test_list_of_all_empty_strings_returns_all_tables(self):
        """全为空字符串的列表视为全量校验。"""
        assert _format_validate_table_display(["", ""]) == "全部表"

    def test_none_does_not_return_literal_placeholder(self):
        """回归测试：全量校验时绝不能返回字面量"指定表"。

        这是本次修复的核心 bug——历史上 display.py:228 用
        action_spec.get("tableName", "指定表") 导致全量校验显示"指定表"。
        """
        assert _format_validate_table_display(None) != "指定表"
