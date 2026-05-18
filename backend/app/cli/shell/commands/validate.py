# backend/app/cli/shell/commands/validate.py
"""
@fileoverview CLI Shell 数据校验命令模块

功能概述:
- 提供 validate 命令在 Shell 中执行数据校验
- 支持按表名过滤或校验全部数据表
- 集成 Spinner 动画与格式化结果输出
- 从项目配置中读取校验超时时间和脚本安全设置

架构设计:
- ValidateCommand 继承 Command 基类
- execute() 方法从项目上下文中读取校验与脚本安全设置
- 委托 ValidationExecutor 执行核心校验逻辑
- 使用 Spinner 在终端显示加载动画
- 通过 Formatter 格式化输出校验结果

输入示例:
    precis> validate
    precis> validate users

输出示例:
    CommandResult.ok("验证通过", data={"errors": [], "duration_ms": 120})
    CommandResult.error("验证完成，发现 3 个错误", data={"errors": [...], "duration_ms": 120})
"""

import os

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.exceptions import ValidationError
from app.cli.shell.formatter import Formatter, Spinner


class ValidateCommand(Command):
    """数据验证命令。

    根据项目配置对数据文件执行校验，可指定表名或验证全部。
    支持别名 'check'。
    """

    def __init__(self):
        super().__init__("validate", aliases=["check"])

    @property
    def description(self) -> str:
        return "执行数据验证，可指定表名或验证全部"

    @property
    def usage(self) -> str:
        return "validate [table_name]"

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行数据校验命令。

        检查项目是否打开，读取项目配置构建校验选项，
        启动 Spinner 执行校验，最后格式化并输出结果。

        Args:
            args: 命令参数列表，可能包含表名用于过滤
            context: 命令上下文，必须包含已打开的项目

        Returns:
            校验结果，成功表示无错误，失败表示发现数据问题

        Raises:
            ValidationError: 当校验过程中发生异常时抛出
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        project_path = context.project_path

        # 获取可选的表名过滤参数（不指定则校验所有表）
        table_name = args[0] if args else None

        # 构建清单文件和数据目录路径
        manifest_path = os.path.join(project_path, "project.precis.yaml")
        data_dir = project_path

        try:
            from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

            # 从项目配置中读取校验设置
            validation_settings = context.project_config.get("validation", {})
            timeout_seconds = int(validation_settings.get("timeout_seconds", 30))
            if timeout_seconds <= 0:
                # 防止配置错误或恶意输入导致超时为负数或零
                timeout_seconds = 30

            # 从项目配置中读取脚本安全设置
            script_security = context.project_config.get("script_security", {})
            allow_unsafe_eval = bool(
                script_security.get("allow_eval", False) or script_security.get("allow_exec", False)
            )

            # 构建校验选项
            options = ValidationOptions(
                timeout_seconds=timeout_seconds,
                allow_unsafe_eval=allow_unsafe_eval,
                table_filter=table_name,
            )

            # 创建校验执行器
            executor = ValidationExecutor(manifest_path)

            Formatter.print_header("开始执行数据校验")

            # 启动终端加载动画
            spinner = Spinner("正在校验数据")
            spinner.start()

            try:
                # 执行核心校验逻辑
                result = executor.execute(data_dir, options)
            finally:
                # 无论成功或失败，确保停止 spinner
                spinner.stop(success=True)

            # 处理并显示加载阶段的警告信息
            loading_errors = result.get("loading_errors", [])
            if loading_errors:
                print(Formatter.warning("\n加载警告:"))
                for err in loading_errors:
                    print(f"  - {err.get('error_type')}: {err.get('message')}")

            # 获取校验错误列表和耗时
            errors = result.get("errors", [])
            duration_ms = result.get("duration_ms", 0)

            print(f"\n校验完成，耗时: {duration_ms} ms")

            # 格式化并打印校验结果
            output = Formatter.format_validation_result(errors)

            print(output)

            # 根据是否有错误返回不同的结果
            if errors:
                return CommandResult.error(
                    f"验证完成，发现 {len(errors)} 个错误", data={"errors": errors, "duration_ms": duration_ms}
                )
            else:
                return CommandResult.ok("验证通过", data={"errors": [], "duration_ms": duration_ms})

        except Exception as e:
            # 将异常包装为 ValidationError 向上抛出
            raise ValidationError(str(e))
