"""@fileoverview help 命令子命令提示单元测试

验证 help 顶层输出会展示聚合命令的子命令提示，
使用户无需先输入命令即可发现 config inspect 等子命令的存在。
"""

from __future__ import annotations

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.commands.config import ConfigCommand
from app.cli.shell.commands.help import HelpCommand
from app.cli.shell.parser import CommandRegistry


class _LeafCommand(Command):
    """无子命令的叶子命令桩。"""

    def __init__(self, name: str, desc: str = "leaf"):
        super().__init__(name)
        self._desc = desc

    @property
    def description(self) -> str:
        return self._desc

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        return CommandResult.ok("ok")


class TestHelpSubcommandHint:
    def test_help_shows_subcommands_for_aggregate_command(self, capsys):
        """help 输出应为有子命令的命令追加 (子命令: ...) 提示。"""
        registry = CommandRegistry()
        registry.register(ConfigCommand())
        registry.register(_LeafCommand("validate", "执行数据验证"))
        help_cmd = HelpCommand(registry)

        help_cmd.execute([], ProjectContext())
        output = capsys.readouterr().out

        # config 行应包含子命令提示，且 inspect 出现在其中
        assert "config" in output
        assert "子命令:" in output
        assert "inspect" in output

    def test_help_no_subcommand_hint_for_leaf_command(self, capsys):
        """help 输出不应为无子命令的叶子命令追加子命令提示。"""
        registry = CommandRegistry()
        registry.register(_LeafCommand("validate", "执行数据验证"))
        help_cmd = HelpCommand(registry)

        help_cmd.execute([], ProjectContext())
        output = capsys.readouterr().out

        assert "validate" in output
        # 叶子命令不应出现子命令提示
        assert "子命令:" not in output

    def test_config_inspect_subcommand_registered(self):
        """ConfigCommand 应注册 inspect 子命令。"""
        config_cmd = ConfigCommand()
        assert "inspect" in config_cmd.list_subcommands()
