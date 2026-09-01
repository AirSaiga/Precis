"""@fileoverview validate 命令 Shell 模式参数解析单元测试

回归：Shell 模式下 `validate --table users` 此前把 "--table" 当表名
（args[0] 直接取位置参数），导致按表过滤失效。
"""

from __future__ import annotations

from unittest.mock import patch

from app.cli.shell.commands.base import ProjectContext
from app.cli.shell.commands.validate import ValidateCommand, _split_positional_args


class TestSplitPositionalArgs:
    def test_strips_options_and_values(self):
        assert _split_positional_args(["--table", "users"]) == []

    def test_keeps_positional_table_name(self):
        assert _split_positional_args(["users"]) == ["users"]

    def test_mixed_options_and_positional(self):
        args = ["--data-directory", "/data", "orders", "--unknown-flag", "x"]
        # 未知 "--" 开头参数不在选项表中，按位置参数保留（保持原顺序）
        assert _split_positional_args(args) == ["orders", "--unknown-flag", "x"]

    def test_trailing_dangling_option_skipped(self):
        assert _split_positional_args(["users", "--table"]) == ["users"]

    def test_empty_args(self):
        assert _split_positional_args([]) == []


class TestShellModeTableFilter:
    """Shell 模式表名过滤：--table 选项优先，其次位置参数。"""

    def _execute(self, args: list[str]):
        cmd = ValidateCommand()
        context = ProjectContext()
        context.project_path = "/fake/project"
        context.project_config = {}
        captured = {}

        def fake_run_validation(manifest_path, data_dir, table_name, settings, security):
            captured["table_name"] = table_name
            from app.cli.shell.commands.base import CommandResult

            return CommandResult.ok("")

        with patch.object(cmd, "_run_validation", side_effect=fake_run_validation):
            cmd.execute(args, context)
        return captured["table_name"]

    def test_table_option_used_as_filter(self):
        """回归：`validate --table users` 应以 users 过滤，而非把 --table 当表名。"""
        assert self._execute(["--table", "users"]) == "users"

    def test_short_table_option_used_as_filter(self):
        assert self._execute(["-t", "orders"]) == "orders"

    def test_positional_table_name_still_works(self):
        assert self._execute(["users"]) == "users"

    def test_no_args_means_all_tables(self):
        assert self._execute([]) is None

    def test_table_option_wins_over_positional(self):
        assert self._execute(["--table", "users", "orders"]) == "users"
