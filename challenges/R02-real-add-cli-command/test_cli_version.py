"""R02 — CLI `version` 命令全链路测试（真实仓库）。

覆盖：命令类遵循 Command 契约、命令在 Shell 中被注册、执行返回包含版本号的字符串。
本文件由 verify.py 复制到 backend/tests/unit/cli/test_r02_version.py 运行。

不假定版本号具体数值——版本号取自包元数据，测试里独立读取并断言其出现在结果中。
"""

from __future__ import annotations

from importlib.metadata import version as pkg_version

from app.cli.shell.commands import VersionCommand
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.commands.version import VersionCommand as VersionCommandFromModule
from app.cli.shell.main import CLIShell


def _expected_version() -> str:
    """读取真实包元数据中的版本号（与命令应使用的方式一致）。失败时回退空串。."""
    try:
        return pkg_version("precis")
    except Exception:
        return ""


# ============================================================================
# 1. 命令类：遵循 Command 契约
# ============================================================================


class TestVersionCommandContract:
    def test_inherits_command(self):
        """VersionCommand 必须继承框架的 Command 抽象基类。"""
        assert issubclass(VersionCommand, Command)

    def test_importable_from_commands_package(self):
        """命令集合包（commands/__init__）应导出 VersionCommand。"""
        # 已在顶部 from app.cli.shell.commands import VersionCommand 成功即说明可导入；
        # 这里再做一次显式断言，便于失败时定位。
        assert VersionCommand is VersionCommandFromModule

    def test_can_instantiate(self):
        cmd = VersionCommand()
        assert isinstance(cmd, Command)

    def test_name_is_version(self):
        cmd = VersionCommand()
        assert cmd.name == "version"

    def test_has_aliases_attribute(self):
        """Command 契约要求 aliases 为列表（可为空）。"""
        cmd = VersionCommand()
        assert isinstance(cmd.aliases, list)

    def test_description_is_nonempty_string(self):
        """Command 契约要求子类实现 description 属性（非空描述）。"""
        cmd = VersionCommand()
        assert isinstance(cmd.description, str)
        assert cmd.description.strip() != ""

    def test_usage_is_string(self):
        """Command 基类提供 usage 属性（默认返回 name），子类可覆盖。"""
        cmd = VersionCommand()
        assert isinstance(cmd.usage, str)
        assert cmd.usage.strip() != ""

    def test_help_text_contains_name_and_description(self):
        """help_text 应包含命令名与描述。"""
        cmd = VersionCommand()
        text = cmd.help_text
        assert "version" in text
        assert cmd.description in text


# ============================================================================
# 2. 注册：命令在 Shell 启动时被注册到 registry
# ============================================================================


class TestVersionCommandRegistration:
    def test_shell_registers_version_command(self):
        """CLIShell 初始化后，registry 应包含 'version' 命令。"""
        shell = CLIShell()
        assert "version" in shell.registry.list_commands()

    def test_registry_get_returns_version_command(self):
        shell = CLIShell()
        cmd = shell.registry.get("version")
        assert cmd is not None
        assert cmd.name == "version"
        assert isinstance(cmd, VersionCommand)

    def test_parser_locates_version_command(self):
        """通过 CommandParser 输入 'version' 应能解析到该命令。"""
        from app.cli.shell.parser import CommandParser

        shell = CLIShell()
        parser = CommandParser(shell.registry)
        command, args = parser.parse("version")
        assert command is not None
        assert command.name == "version"
        assert args == []

    def test_executor_runs_version_via_input_line(self):
        """通过 CommandExecutor 执行 'version' 应返回成功结果。"""
        from app.cli.shell.parser import CommandExecutor, CommandParser

        shell = CLIShell()
        executor = CommandExecutor(CommandParser(shell.registry), ProjectContext())
        result = executor.execute("version")
        assert result.success is True
        assert result.message.strip() != ""


# ============================================================================
# 3. 执行行为：返回包含版本号的字符串
# ============================================================================


class TestVersionCommandExecute:
    def test_execute_returns_command_result(self):
        cmd = VersionCommand()
        result = cmd.execute([], ProjectContext())
        assert isinstance(result, CommandResult)

    def test_execute_succeeds(self):
        cmd = VersionCommand()
        result = cmd.execute([], ProjectContext())
        assert result.success is True

    def test_execute_message_nonempty(self):
        cmd = VersionCommand()
        result = cmd.execute([], ProjectContext())
        assert isinstance(result.message, str)
        assert result.message.strip() != ""

    def test_execute_message_contains_version_number(self):
        """结果消息必须包含真实版本号（取自包元数据），不得是占位/空串。"""
        cmd = VersionCommand()
        result = cmd.execute([], ProjectContext())
        expected = _expected_version()
        assert expected, "测试环境未能读取 precis 包版本，环境异常"
        assert expected in result.message, (
            f"版本号 {expected!r} 未出现在命令输出 {result.message!r} 中"
        )

    def test_execute_does_not_trigger_exit(self):
        """version 是只读信息命令，不应触发 Shell 退出。"""
        cmd = VersionCommand()
        result = cmd.execute([], ProjectContext())
        assert result.should_exit is False

    def test_execute_ignores_extra_args(self):
        """传入多余参数不应崩溃（只读命令宽容处理）。"""
        cmd = VersionCommand()
        result = cmd.execute(["--anything"], ProjectContext())
        assert result.success is True
        assert _expected_version() in result.message
