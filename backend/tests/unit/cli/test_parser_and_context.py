"""
@fileoverview CLI 解析器与上下文单元测试

覆盖范围:
- CommandParser 的空输入、引号参数、多空格分割
- ProjectContext 的 project_path/project_config 属性与状态字典同步
"""

from __future__ import annotations

import pytest

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.exceptions import CommandNotFoundError
from app.cli.shell.parser import CommandParser, CommandRegistry


class _FakeCommand(Command):
    """用于解析器测试的最小命令桩。"""

    def __init__(self, name: str, aliases: list[str] | None = None):
        super().__init__(name, aliases)

    @property
    def description(self) -> str:
        return "fake command for tests"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        return CommandResult.ok("fake")


class TestCommandParser:
    """命令解析器行为测试。"""

    def test_empty_input_returns_none(self):
        """空输入应返回 (None, [])。"""
        registry = CommandRegistry()
        parser = CommandParser(registry)
        command, args = parser.parse("")
        assert command is None
        assert args == []

    def test_whitespace_only_input_returns_none(self):
        """仅空白字符的输入应返回 (None, [])。"""
        registry = CommandRegistry()
        parser = CommandParser(registry)
        command, args = parser.parse("   \t\n  ")
        assert command is None
        assert args == []

    def _make_parser_with_cmd(self, name: str = "cmd", aliases: list[str] | None = None):
        """构造已注册占位命令的解析器。"""
        registry = CommandRegistry()
        registry.register(_FakeCommand(name, aliases))
        return CommandParser(registry)

    def test_simple_args_split(self):
        """普通参数按空格分割。"""
        parser = self._make_parser_with_cmd()
        command, args = parser.parse("cmd arg1 arg2")
        assert command is not None
        assert command.name == "cmd"
        assert args == ["arg1", "arg2"]

    def test_double_quoted_arg_keeps_spaces(self):
        """双引号包裹的参数保留内部空格。"""
        parser = self._make_parser_with_cmd()
        command, args = parser.parse('cmd "hello world" "foo bar"')
        assert args == ["hello world", "foo bar"]

    def test_single_quoted_arg_keeps_spaces(self):
        """单引号包裹的参数保留内部空格。"""
        parser = self._make_parser_with_cmd()
        command, args = parser.parse("cmd 'hello world' 'foo bar'")
        assert args == ["hello world", "foo bar"]

    def test_mixed_quotes(self):
        """混合引号应正确解析。"""
        parser = self._make_parser_with_cmd()
        command, args = parser.parse("cmd \"double quoted\" 'single quoted' plain")
        assert args == ["double quoted", "single quoted", "plain"]

    def test_multiple_spaces_between_args(self):
        """多个空格应被压缩为一个分隔符。"""
        parser = self._make_parser_with_cmd()
        command, args = parser.parse("cmd   arg1    arg2")
        assert args == ["arg1", "arg2"]

    def test_unmatched_quote_treats_rest_as_literal(self):
        """未闭合引号时，剩余内容作为字面量。"""
        parser = self._make_parser_with_cmd()
        command, args = parser.parse('cmd "unclosed quote')
        assert args == ["unclosed quote"]

    def test_command_lookup_by_name(self):
        """按名称查找已注册命令。"""
        from app.cli.shell.commands.exit import ExitCommand

        registry = CommandRegistry()
        cmd = ExitCommand()
        registry.register(cmd)

        parser = CommandParser(registry)
        found, args = parser.parse("exit")
        assert found is cmd
        assert args == []

    def test_command_lookup_by_alias(self):
        """按别名查找已注册命令。"""
        registry = CommandRegistry()
        cmd = _FakeCommand("status", aliases=["st"])
        registry.register(cmd)

        parser = CommandParser(registry)
        found, args = parser.parse("st")
        assert found is cmd
        assert args == []

    def test_unknown_command_raises(self):
        """未知命令应抛出 CommandNotFoundError。"""
        registry = CommandRegistry()
        parser = CommandParser(registry)
        with pytest.raises(CommandNotFoundError):
            parser.parse("not_a_command")


class TestProjectContext:
    """项目上下文行为测试。"""

    def test_initial_state_is_empty(self):
        """初始状态为空，未打开项目。"""
        ctx = ProjectContext()
        assert not ctx.is_project_open
        assert ctx.project_path is None
        assert ctx.project_config is None
        assert not ctx.has("project_path")

    def test_project_path_syncs_to_state(self):
        """设置 project_path 会同步到状态字典。"""
        ctx = ProjectContext()
        ctx.project_path = "/tmp/project"
        assert ctx.is_project_open
        assert ctx.project_path == "/tmp/project"
        assert ctx.get("project_path") == "/tmp/project"

    def test_project_config_syncs_to_state(self):
        """设置 project_config 会同步到状态字典。"""
        ctx = ProjectContext()
        config = {"project": {"name": "Demo"}}
        ctx.project_config = config
        assert ctx.project_config is config
        assert ctx.get("project_config") is config

    def test_close_project_clears_state(self):
        """将 project_path 设为 None 会清除状态。"""
        ctx = ProjectContext()
        ctx.project_path = "/tmp/project"
        ctx.project_path = None
        assert not ctx.is_project_open
        assert ctx.project_path is None
        assert ctx.get("project_path") is None

    def test_context_inheritance(self):
        """ProjectContext 继承 CommandContext 的 set/get/has 能力。"""
        ctx = ProjectContext()
        ctx.set("custom_key", "custom_value")
        assert ctx.has("custom_key")
        assert ctx.get("custom_key") == "custom_value"
