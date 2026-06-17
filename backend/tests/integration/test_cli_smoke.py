"""
@fileoverview CLI Shell 集成测试

测试 CLI Shell 的端到端行为：
- ValidateCommand standalone 模式（针对 qa_test/qa_simple 真实项目）
- ValidateCommand 错误处理（manifest 不存在等）
- CommandParser 引号处理、参数分割
- CommandResult / CommandContext 状态管理
- main() 入口的退出码语义（成功/失败）
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import pytest

from app.cli.shell.commands.base import CommandResult, ProjectContext
from app.cli.shell.commands.open import OpenCommand
from app.cli.shell.commands.validate import ValidateCommand, _parse_standalone_args
from app.cli.shell.main import CLIShell
from app.cli.shell.main import main as cli_main
from app.cli.shell.parser import CommandExecutor, CommandParser, CommandRegistry

# qa_test/qa_simple 是仓库内置的最小可运行 V2 项目
QA_SIMPLE_ROOT = Path(__file__).resolve().parents[3] / "qa_test" / "qa_simple"


class TestCommandResult:
    """CommandResult 数据类测试"""

    def test_ok_factory(self):
        r = CommandResult.ok("ok", data={"x": 1})
        assert r.success is True
        assert r.message == "ok"
        assert r.data == {"x": 1}
        assert r.should_exit is False

    def test_error_factory(self):
        r = CommandResult.error("bad")
        assert r.success is False
        assert r.message == "bad"
        assert r.data is None
        assert r.should_exit is False

    def test_exit_factory(self):
        r = CommandResult.exit()
        assert r.success is True
        assert r.should_exit is True


class TestProjectContext:
    """ProjectContext 测试"""

    def test_is_project_open_initially_false(self):
        ctx = ProjectContext()
        assert ctx.is_project_open is False
        assert ctx.project_path is None
        assert ctx.project_config is None

    def test_set_project_path_marks_open(self):
        ctx = ProjectContext()
        ctx.project_path = "/path/to/proj"
        ctx.project_config = {"project": {"id": "p"}}
        assert ctx.is_project_open is True
        assert ctx.project_path == "/path/to/proj"
        assert ctx.project_config == {"project": {"id": "p"}}

    def test_setters_sync_to_state_dict(self):
        """设置 project_path/config 时应同步到父类的 _state，便于统一访问。"""
        ctx = ProjectContext()
        ctx.project_path = "/p"
        ctx.project_config = {"k": "v"}
        assert ctx.get("project_path") == "/p"
        assert ctx.get("project_config") == {"k": "v"}


class TestOpenCommand:
    """OpenCommand 顶层/子命令行为测试"""

    def test_open_no_args_uses_history_selection(self, tmp_path, monkeypatch):
        """无参数不再报错，而是从历史选择（空历史时给出提示）。

        原 '缺少项目路径参数' 的行为已改为方案A（交互选择）。
        """
        # 隔离历史文件为空，确保进入"空历史"分支而非阻塞在 readchar
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))
        cmd = OpenCommand()
        result = cmd.execute([], ProjectContext())
        assert result.success is True
        assert "暂无项目打开历史" in result.message

    def test_open_rejects_nonexistent_path(self):
        cmd = OpenCommand()
        result = cmd.execute(["/nonexistent/path/for/test"], ProjectContext())
        assert result.success is False
        assert "项目路径不存在" in result.message

    def test_open_rejects_file_path(self, tmp_path):
        file_path = tmp_path / "not_a_dir.txt"
        file_path.write_text("x", encoding="utf-8")
        cmd = OpenCommand()
        result = cmd.execute([str(file_path)], ProjectContext())
        assert result.success is False
        assert "路径不是目录" in result.message

    def test_open_sets_context_project_path(self, tmp_path, monkeypatch):
        # 隔离历史文件，避免测试污染真实的 ~/.precis_project_history
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))
        proj = tmp_path / "proj"
        proj.mkdir()
        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute([str(proj)], ctx)
        assert result.success is True
        assert ctx.is_project_open is True
        assert ctx.project_path == str(proj.resolve())

    def test_open_detects_manifest(self, tmp_path, monkeypatch):
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "project.precis.yaml").write_text("project: {id: x, name: x}\n", encoding="utf-8")
        cmd = OpenCommand()
        result = cmd.execute([str(proj)], ProjectContext())
        assert result.success is True
        assert "检测到项目清单文件" in result.message

    def test_open_loads_manifest_into_context(self, tmp_path, monkeypatch):
        """打开项目时应加载清单到 ctx.project_config，使提示符能显示真实项目名。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject: {id: demo, name: DemoProject}\n", encoding="utf-8"
        )
        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute([str(proj)], ctx)
        assert result.success is True
        # project_config 应被填充为字典，且能取到真实项目名
        assert ctx.project_config is not None
        assert ctx.project_config["project"]["name"] == "DemoProject"

    def test_open_manifest_parse_failure_does_not_block(self, tmp_path, monkeypatch):
        """清单存在但格式非法时，不应阻断项目切换，仅给出警告并清空配置。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))
        proj = tmp_path / "proj"
        proj.mkdir()
        # 缺少必填 project 字段 → load_manifest 校验失败
        (proj / "project.precis.yaml").write_text("version: 2\n", encoding="utf-8")
        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute([str(proj)], ctx)
        assert result.success is True
        # 项目仍切换成功
        assert ctx.is_project_open is True
        # 但配置未加载，避免消费侧拿到部分数据
        assert ctx.project_config is None
        assert "解析失败" in result.message

    def test_open_real_qa_simple_loads_config(self, tmp_path, monkeypatch):
        """针对仓库内置 qa_simple 项目验证真实清单加载。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))
        if not QA_SIMPLE_ROOT.exists():
            pytest.skip("qa_simple 测试项目不存在")
        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute([str(QA_SIMPLE_ROOT)], ctx)
        assert result.success is True
        assert ctx.project_config is not None
        # qa_simple 的清单 project.name 在仓库中是固定的
        assert ctx.project_config["project"]["name"]

    def test_open_alias_registered_at_top_level(self):
        shell = CLIShell()
        cmd = shell.registry.get("o")
        assert cmd is not None
        assert cmd.name == "open"

    # ------------------------------------------------------------------
    # 方案A：open（无参数）从历史交互选择
    # ------------------------------------------------------------------

    def test_open_no_args_opens_selected_from_history(self, tmp_path, monkeypatch):
        """无参数时弹出菜单，选中后打开对应项目。"""
        # 隔离历史文件
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))

        # 准备一个真实可打开的项目目录
        proj = tmp_path / "proj"
        proj.mkdir()
        (proj / "project.precis.yaml").write_text(
            "version: 2\nproject: {id: demo, name: DemoProject}\n", encoding="utf-8"
        )

        # 写入历史（顺序：最新在前）
        from app.cli.shell.commands.open import _save_history

        _save_history([{"path": str(proj), "last_opened": None}])

        # mock InteractiveMenu.show 返回该项目路径（模拟用户选中第 1 项）
        monkeypatch.setattr(
            "app.cli.shell.interactive_menu.InteractiveMenu.show",
            lambda self: str(proj),
        )

        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute([], ctx)
        assert result.success is True
        assert ctx.is_project_open is True
        assert ctx.project_path == str(proj.resolve())
        # 清单应被加载，配置填充
        assert ctx.project_config is not None
        assert ctx.project_config["project"]["name"] == "DemoProject"

    def test_open_no_args_cancel_does_not_open(self, tmp_path, monkeypatch):
        """用户在菜单中取消时返回提示，不打开任何项目。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))

        proj = tmp_path / "proj"
        proj.mkdir()
        from app.cli.shell.commands.open import _save_history

        _save_history([{"path": str(proj), "last_opened": None}])

        # 模拟用户取消（ESC/0/选取消项）→ show() 返回 None
        monkeypatch.setattr(
            "app.cli.shell.interactive_menu.InteractiveMenu.show",
            lambda self: None,
        )

        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute([], ctx)
        assert result.success is True
        assert "已取消" in result.message
        assert ctx.is_project_open is False

    # ------------------------------------------------------------------
    # 方案B：open <N> 按历史序号打开
    # ------------------------------------------------------------------

    def test_open_by_index_opens_nth(self, tmp_path, monkeypatch):
        """open 1 打开历史第 1 项（最新）。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))

        proj1 = tmp_path / "proj1"
        proj1.mkdir()
        proj2 = tmp_path / "proj2"
        proj2.mkdir()
        from app.cli.shell.commands.open import _save_history

        # 历史顺序：proj2 最新（第 1 项），proj1 次之（第 2 项）
        _save_history(
            [
                {"path": str(proj2), "last_opened": None},
                {"path": str(proj1), "last_opened": None},
            ]
        )

        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute(["1"], ctx)
        assert result.success is True
        assert ctx.project_path == str(proj2.resolve())

        # 验证第 2 项
        ctx2 = ProjectContext()
        result2 = cmd.execute(["2"], ctx2)
        assert result2.success is True
        assert ctx2.project_path == str(proj1.resolve())

    def test_open_by_index_out_of_range_errors(self, tmp_path, monkeypatch):
        """序号越界时报错并提示总数。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))

        proj = tmp_path / "proj"
        proj.mkdir()
        from app.cli.shell.commands.open import _save_history

        _save_history([{"path": str(proj), "last_opened": None}])

        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute(["99"], ctx)
        assert result.success is False
        assert "共 1 项" in result.message
        assert ctx.is_project_open is False

    def test_open_by_index_empty_history_errors(self, tmp_path, monkeypatch):
        """无历史时按序号打开应报错提示。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))

        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute(["1"], ctx)
        assert result.success is False
        assert "暂无项目打开历史" in result.message

    def test_open_relative_path_not_treated_as_index(self, tmp_path, monkeypatch):
        """回归：open ./1 这类相对路径不应被当成序号（'./1'.isdigit() 为 False）。"""
        monkeypatch.setattr("app.cli.shell.commands.open.HISTORY_FILE", str(tmp_path / "history.json"))

        # 创建名为 "1" 的子目录，从 tmp_path 切过去用相对路径打开
        target = tmp_path / "1"
        target.mkdir()
        # 切换工作目录到 tmp_path，使 "./1" 解析到 target
        monkeypatch.chdir(tmp_path)

        cmd = OpenCommand()
        ctx = ProjectContext()
        result = cmd.execute(["./1"], ctx)
        assert result.success is True
        assert ctx.project_path == str(target.resolve())


class TestStandaloneArgsParser:
    """_parse_standalone_args 单元测试"""

    def test_no_args(self):
        result = _parse_standalone_args([])
        assert result == {"manifest": None, "data_directory": None, "table": None}

    def test_long_options(self):
        result = _parse_standalone_args(
            [
                "--manifest",
                "/m.yaml",
                "--data-directory",
                "/data",
                "--table",
                "users",
            ]
        )
        assert result["manifest"] == "/m.yaml"
        assert result["data_directory"] == "/data"
        assert result["table"] == "users"

    def test_short_options(self):
        result = _parse_standalone_args(["-m", "/m.yaml", "-d", "/data", "-t", "users"])
        assert result["manifest"] == "/m.yaml"
        assert result["data_directory"] == "/data"
        assert result["table"] == "users"

    def test_mixed_known_and_unknown_args(self):
        """未识别的参数被忽略，不抛异常。"""
        result = _parse_standalone_args(["--manifest", "/m", "extra_positional", "--unknown", "x"])
        assert result["manifest"] == "/m"
        assert result["data_directory"] is None
        assert result["table"] is None


class TestCommandParser:
    """CommandParser 引号与参数分割测试"""

    def test_simple_command(self):
        registry = CommandRegistry()
        cmd = ValidateCommand()
        registry.register(cmd)
        parser = CommandParser(registry)

        command, args = parser.parse("validate users")
        assert command is cmd
        assert args == ["users"]

    def test_quoted_args_with_spaces(self):
        registry = CommandRegistry()
        cmd = ValidateCommand()
        registry.register(cmd)
        parser = CommandParser(registry)

        command, args = parser.parse('validate --manifest "C:/path with space/m.yaml"')
        assert command is cmd
        assert args == ["--manifest", "C:/path with space/m.yaml"]

    def test_single_quoted_args(self):
        registry = CommandRegistry()
        cmd = ValidateCommand()
        registry.register(cmd)
        parser = CommandParser(registry)

        command, args = parser.parse("validate --manifest 'C:/a b/m.yaml'")
        assert args == ["--manifest", "C:/a b/m.yaml"]

    def test_empty_input(self):
        parser = CommandParser(CommandRegistry())
        command, args = parser.parse("")
        assert command is None
        assert args == []

    def test_unknown_command_raises(self):
        parser = CommandParser(CommandRegistry())
        with pytest.raises(Exception):
            parser.parse("nonsense_command")

    def test_alias_lookup(self):
        registry = CommandRegistry()
        cmd = ValidateCommand()  # has alias "check"
        registry.register(cmd)
        parser = CommandParser(registry)
        command, _ = parser.parse("check")
        assert command is cmd


class TestCommandExecutor:
    """CommandExecutor 编排测试"""

    def test_execute_returns_command_result(self):
        registry = CommandRegistry()
        cmd = ValidateCommand()
        registry.register(cmd)
        parser = CommandParser(registry)
        executor = CommandExecutor(parser, ProjectContext())

        # 调用 shell 模式但项目未打开，应返回错误
        result = executor.execute("validate")
        assert result.success is False
        assert "未打开项目" in result.message or "open" in result.message

    def test_execute_unknown_command_returns_error(self):
        executor = CommandExecutor(CommandParser(CommandRegistry()), ProjectContext())
        result = executor.execute("foo")
        assert result.success is False


class TestValidateCommandShellMode:
    """ValidateCommand 在 Shell 模式下的行为（要求先 open 项目）"""

    def test_shell_mode_requires_open_project(self):
        cmd = ValidateCommand()
        ctx = ProjectContext()
        result = cmd.execute([], ctx)
        assert result.success is False
        assert "未打开项目" in result.message

    def test_shell_mode_with_open_project(self, tmp_path):
        """当项目已 open 时应执行校验。"""
        # 复制 qa_simple 到 tmp_path 以避免污染源文件
        if not QA_SIMPLE_ROOT.is_dir():
            pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")

        import shutil

        proj = tmp_path / "proj"
        shutil.copytree(QA_SIMPLE_ROOT, proj)

        cmd = ValidateCommand()
        ctx = ProjectContext()
        ctx.project_path = str(proj)
        # 简化项目配置：跳过 security（沙箱已默认开启）
        ctx.project_config = {"validation": {"timeout_seconds": 30}, "script_security": {}}

        result = cmd.execute([], ctx)
        # qa_simple 数据无错误 → 校验通过
        assert result.success is True
        assert result.data is not None
        assert result.data.get("errors") == []


class TestValidateCommandStandaloneMode:
    """ValidateCommand 在 standalone 模式（CI 自动化）下的行为"""

    @pytest.fixture
    def real_qa_simple(self, tmp_path):
        """复制 qa_simple 真实项目到 tmp_path 以避免污染源。"""
        if not QA_SIMPLE_ROOT.is_dir():
            pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")
        proj = tmp_path / "qa_simple"
        import shutil

        shutil.copytree(QA_SIMPLE_ROOT, proj)
        return proj

    def test_standalone_missing_manifest(self):
        cmd = ValidateCommand()
        result = cmd.execute(
            ["--manifest", "/nonexistent/path/project.precis.yaml"],
            ProjectContext(),
        )
        assert result.success is False
        assert "清单文件不存在" in result.message

    def test_standalone_missing_data_dir(self, tmp_path):
        manifest = tmp_path / "proj.yaml"
        manifest.write_text("project: {id: x, name: x}\n", encoding="utf-8")

        cmd = ValidateCommand()
        result = cmd.execute(
            ["--manifest", str(manifest), "--data-directory", "/nonexistent/dir"],
            ProjectContext(),
        )
        assert result.success is False
        assert "数据目录不存在" in result.message

    def test_standalone_validates_real_qa_simple(self, real_qa_simple):
        """针对 qa_test/qa_simple 真实项目执行校验，应通过。"""
        manifest = real_qa_simple / "project.precis.yaml"
        data_dir = real_qa_simple / "data"

        cmd = ValidateCommand()
        result = cmd.execute(
            ["--manifest", str(manifest), "--data-directory", str(data_dir)],
            ProjectContext(),
        )
        assert result.success is True, f"Validation failed: {result.message}"
        data = result.data or {}
        assert data.get("errors") == []
        assert "duration_ms" in data
        assert isinstance(data["duration_ms"], int)

    def test_standalone_uses_manifest_dir_as_default_data_dir(self, tmp_path):
        """未指定 --data-directory 时应使用 manifest 所在目录。"""
        # 构造一个最小项目：manifest + 空 schemas/constraints
        proj = tmp_path / "min"
        proj.mkdir()
        (proj / "schemas").mkdir()
        (proj / "data").mkdir()
        (proj / "data" / "t.csv").write_text("a,b\n1,2\n", encoding="utf-8")
        (proj / "schemas" / "t.schema.yaml").write_text(
            """version: 2
id: t
name: t
source:
  mode: relative_file
  path: data/t.csv
columns:
  - id: a
    name: a
    type: integer
  - id: b
    name: b
    type: integer
""",
            encoding="utf-8",
        )
        (proj / "project.precis.yaml").write_text(
            """version: 2
project:
  id: min
  name: min
schemas:
  - id: t
    path: schemas/t.schema.yaml
""",
            encoding="utf-8",
        )

        cmd = ValidateCommand()
        result = cmd.execute(["--manifest", str(proj / "project.precis.yaml")], ProjectContext())
        assert result.success is True, f"Validation failed: {result.message}"


class TestCliMainEntry:
    """main() 入口的退出码语义"""

    def test_main_returns_zero_on_validation_success(self, tmp_path):
        """校验通过时返回 0。"""
        if not QA_SIMPLE_ROOT.is_dir():
            pytest.skip(f"qa_simple fixture not found at {QA_SIMPLE_ROOT}")

        import shutil

        proj = tmp_path / "qa_simple"
        shutil.copytree(QA_SIMPLE_ROOT, proj)

        args = [
            "validate",
            "--manifest",
            str(proj / "project.precis.yaml"),
            "--data-directory",
            str(proj / "data"),
        ]
        rc = cli_main(args)
        assert rc == 0

    def test_main_returns_nonzero_on_validation_failure(self, tmp_path):
        """校验失败时返回非 0。"""
        proj = tmp_path / "bad"
        proj.mkdir()
        # 缺失 manifest 文件
        args = ["validate", "--manifest", str(proj / "nonexistent.yaml")]
        rc = cli_main(args)
        assert rc != 0

    def test_main_help_command(self, capsys):
        """help 命令在 standalone 模式下应能执行。"""
        rc = cli_main(["help"])
        captured = capsys.readouterr()
        # help 命令应输出可用命令列表到 stdout
        assert "validate" in captured.out
        assert rc == 0


class TestCliShellInitialization:
    """CLIShell 类的初始化与命令注册"""

    def test_shell_registers_all_builtin_commands(self):
        shell = CLIShell()
        commands = shell.registry.list_commands()
        # 至少应注册这些核心命令
        for name in ("help", "open", "validate", "exit", "project"):
            assert name in commands, f"Missing built-in command: {name}"

    def test_project_command_has_open_and_status_subcommands(self):
        shell = CLIShell()
        project_cmd = shell.registry.get("project")
        assert project_cmd is not None
        subcommands = project_cmd.list_subcommands()
        assert "open" in subcommands
        assert "status" in subcommands
        assert "history" in subcommands

    def test_shell_validate_command_has_check_alias(self):
        shell = CLIShell()
        # 通过 alias "check" 也应该能找到 validate
        cmd = shell.registry.get("check")
        assert cmd is not None
        assert cmd.name == "validate"
