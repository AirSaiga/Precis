# backend/app/cli/shell/commands/validate.py
"""
@fileoverview CLI Shell 数据校验命令模块

功能概述:
- 提供 validate 命令在 Shell 中执行数据校验
- 支持按表名过滤或校验全部数据表
- 支持 standalone 模式：通过 --manifest / --data-directory 参数直接执行，无需先 open 项目
- 集成 Spinner 动画与格式化结果输出
- 从项目配置中读取校验超时时间和脚本安全设置

架构设计:
- ValidateCommand 继承 Command 基类
- 两种工作模式:
  - Shell 模式: 先 open 项目，再 validate [table_name]，从上下文读取设置
  - Standalone 模式: validate --manifest <path> [--data-directory <path>] [--table <name>]
    不依赖项目上下文，适合脚本自动化 / CI 场景
- 委托 ValidationExecutor 执行核心校验逻辑
- 使用 Spinner 在终端显示加载动画
- 通过 Formatter 格式化输出校验结果

输入示例:
    # Shell 模式（交互式）
    precis> open /my/project
    precis> validate
    precis> validate users

    # Standalone 模式（单次执行，适合自动化）
    precis validate --manifest /my/project/project.precis.yaml
    precis validate --manifest /my/project/project.precis.yaml --data-directory /my/project/data --table users

输出示例:
    CommandResult.ok("验证通过", data={"errors": [], "duration_ms": 120})
    CommandResult.error("验证完成，发现 3 个错误", data={"errors": [...], "duration_ms": 120})
"""

import os

from rich.console import Console

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.exceptions import ValidationError
from app.cli.shell.formatter import Formatter, Spinner

_console = Console()


def _parse_standalone_args(args: list[str]) -> dict:
    """解析 standalone 模式的命名参数。

    从参数列表中提取 --manifest/-m、--data-directory/-d、--table/-t 选项。
    不以 -- 或 - 开头的裸参数在无 --manifest 时被忽略（由 Shell 模式处理）。

    Args:
        args: 命令参数列表

    Returns:
        包含 manifest、data_directory、table 键的字典，未提供的键值为 None
    """
    result = {"manifest": None, "data_directory": None, "table": None}
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("--manifest", "-m") and i + 1 < len(args):
            result["manifest"] = args[i + 1]
            i += 2
        elif arg in ("--data-directory", "-d") and i + 1 < len(args):
            result["data_directory"] = args[i + 1]
            i += 2
        elif arg in ("--table", "-t") and i + 1 < len(args):
            result["table"] = args[i + 1]
            i += 2
        else:
            i += 1
    return result


class ValidateCommand(Command):
    """数据验证命令。

    根据项目配置对数据文件执行校验，可指定表名或验证全部。
    支持别名 'check'。

    两种工作模式:
    - Shell 模式: 需先 open 项目，从上下文读取设置
    - Standalone 模式: 通过 --manifest 指定清单文件，不依赖项目上下文
    """

    def __init__(self):
        super().__init__("validate", aliases=["check"])

    @property
    def description(self) -> str:
        return "执行数据验证，可指定表名或验证全部"

    @property
    def usage(self) -> str:
        return "validate [table_name]\n  validate --manifest <path> [--data-directory <path>] [--table <name>]"

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行数据校验命令。

        自动检测工作模式:
        - 如果 args 中包含 --manifest/-m，进入 standalone 模式
        - 否则进入 Shell 模式（要求已 open 项目）

        Args:
            args: 命令参数列表
            context: 命令上下文

        Returns:
            校验结果，成功表示无错误，失败表示发现数据问题

        Raises:
            ValidationError: 当校验过程中发生异常时抛出
        """
        # 检测是否为 standalone 模式
        parsed = _parse_standalone_args(args)
        if parsed["manifest"] is not None:
            return self._execute_standalone(parsed)

        # Shell 模式：要求已打开项目
        return self._execute_shell(args, context)

    def _execute_shell(self, args: list[str], context: CommandContext) -> CommandResult:
        """Shell 模式执行校验。

        从项目上下文中读取路径和设置，执行校验。

        Args:
            args: 命令参数列表，可能包含表名
            context: 命令上下文，必须包含已打开的项目

        Returns:
            校验结果
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        project_path = context.project_path

        # 获取可选的表名过滤参数（不指定则校验所有表）
        table_name = args[0] if args else None

        # 构建清单文件和数据目录路径
        manifest_path = os.path.join(project_path, "project.precis.yaml")
        data_dir = project_path

        # 从项目配置中读取设置
        validation_settings = context.project_config.get("validation", {}) if context.project_config else {}
        script_security = context.project_config.get("script_security", {}) if context.project_config else {}

        return self._run_validation(manifest_path, data_dir, table_name, validation_settings, script_security)

    def _execute_standalone(self, parsed: dict) -> CommandResult:
        """Standalone 模式执行校验。

        直接从命令行参数获取路径，不依赖项目上下文。
        使用默认设置（timeout=30, 安全沙箱）。

        Args:
            parsed: 解析后的参数字典，包含 manifest/data_directory/table

        Returns:
            校验结果
        """
        manifest_path = os.path.abspath(parsed["manifest"])

        if not os.path.exists(manifest_path):
            return CommandResult.error(f"清单文件不存在: {manifest_path}")

        # 数据目录：显式指定 > 清单文件所在目录
        if parsed["data_directory"]:
            data_dir = os.path.abspath(parsed["data_directory"])
        else:
            data_dir = os.path.dirname(manifest_path)

        if not os.path.isdir(data_dir):
            return CommandResult.error(f"数据目录不存在: {data_dir}")

        table_name = parsed["table"]

        # standalone 模式使用默认设置
        return self._run_validation(manifest_path, data_dir, table_name, {}, {})

    def _run_validation(
        self,
        manifest_path: str,
        data_dir: str,
        table_name: str | None,
        validation_settings: dict,
        script_security: dict,
    ) -> CommandResult:
        """执行校验的核心逻辑，Shell 和 Standalone 模式共享。

        Args:
            manifest_path: 清单文件路径
            data_dir: 数据目录路径
            table_name: 可选的表名过滤
            validation_settings: 校验设置字典
            script_security: 脚本安全设置字典

        Returns:
            校验结果

        Raises:
            ValidationError: 当校验过程中发生异常时抛出
        """
        try:
            from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

            timeout_seconds = int(validation_settings.get("timeout_seconds", 30))
            if timeout_seconds <= 0:
                timeout_seconds = 30

            allow_unsafe_eval = bool(
                script_security.get("allow_eval", False) or script_security.get("allow_exec", False)
            )

            options = ValidationOptions(
                timeout_seconds=timeout_seconds,
                allow_unsafe_eval=allow_unsafe_eval,
                table_filter=table_name,
            )

            executor = ValidationExecutor(manifest_path)

            Formatter.print_header("开始执行数据校验")

            spinner = Spinner("正在校验数据")
            spinner.start()

            try:
                result = executor.execute(data_dir, options)
            finally:
                spinner.stop(success=True)

            # 处理并显示加载阶段的警告信息
            loading_errors = result.get("loading_errors", [])
            if loading_errors:
                _console.print("\n[yellow]加载警告:[/yellow]")
                for err in loading_errors:
                    _console.print(f"  - {err.get('error_type')}: {err.get('message')}")

            errors = result.get("errors", [])
            duration_ms = result.get("duration_ms", 0)

            _console.print(f"\n校验完成，耗时: {duration_ms} ms")

            # 输出校验摘要：列出加载的表/行数与每项约束的通过状态，
            # 证明 validate 确实执行了校验（而非空转返回通过）。
            summary = Formatter.format_validation_summary(
                result.get("validation_details"),
                result.get("raw_datasets"),
            )
            _console.print(summary)

            output = Formatter.format_validation_result(errors)
            _console.print(output)

            if errors:
                return CommandResult.error("", data={"errors": errors, "duration_ms": duration_ms})
            else:
                return CommandResult.ok("", data={"errors": [], "duration_ms": duration_ms})

        except Exception as e:
            raise ValidationError(str(e))
