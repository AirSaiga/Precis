# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
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
    precis validate --manifest /my/project/project.precis.yaml --format json

输出示例:
    CommandResult.ok("验证通过", data={"errors": [], "duration_ms": 120})
    CommandResult.error("验证完成，发现 3 个错误", data={"errors": [...], "duration_ms": 120})
"""

import json
import os
import sys

from rich.console import Console

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.exceptions import ValidationError
from app.cli.shell.formatter import Formatter, Spinner
from app.shared.services.validation.json_payload import build_json_payload as _build_json_payload

_console = Console()

# --format 的合法取值（JSON 契约版本号单一事实源在 validation.json_payload）
_FORMAT_CHOICES = ("human", "json")


# 选项表（单一事实源）：standalone 解析与 Shell 模式选项剥离共用
_STANDALONE_OPTIONS: dict[str, str] = {
    "--manifest": "manifest",
    "-m": "manifest",
    "--data-directory": "data_directory",
    "-d": "data_directory",
    "--table": "table",
    "-t": "table",
    "--format": "format",
    "--report": "report",
}


def _parse_standalone_args(args: list[str]) -> dict:
    """解析 standalone 模式的命名参数。

    从参数列表中提取 --manifest/-m、--data-directory/-d、--table/-t、--format 选项。
    不以 -- 或 - 开头的裸参数在无 --manifest 时被忽略（由 Shell 模式处理）。

    Args:
        args: 命令参数列表

    Returns:
        包含 manifest、data_directory、table、format、report 键的字典，未提供的键值为 None
    """
    result: dict[str, str | None] = {
        "manifest": None,
        "data_directory": None,
        "table": None,
        "format": None,
        "report": None,
    }
    i = 0
    while i < len(args):
        arg = args[i]
        key = _STANDALONE_OPTIONS.get(arg)
        if key and i + 1 < len(args):
            result[key] = args[i + 1]
            i += 2
        else:
            i += 1
    return result


def _split_positional_args(args: list[str]) -> list[str]:
    """剥离 args 中的选项及选项值，返回剩余位置参数。

    Shell 模式下用户可能混用选项（如 `validate --table users`），
    直接取 args[0] 当表名会把 "--table" 当成表名。此函数按选项表
    跳过每个选项及其值；尾部悬挂选项（缺值）仅跳过自身。

    Args:
        args: 命令参数列表

    Returns:
        剩余的位置参数列表
    """
    positional: list[str] = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in _STANDALONE_OPTIONS and i + 1 < len(args):
            i += 2  # 跳过选项及其值
        elif arg in _STANDALONE_OPTIONS:
            i += 1  # 尾部悬挂选项（缺值），仅跳过自身
        else:
            positional.append(arg)
            i += 1
    return positional


class ValidateCommand(Command):
    """数据验证命令。

    根据项目配置对数据文件执行校验，可指定表名或验证全部。
    支持别名 'check'。

    两种工作模式:
    - Shell 模式: 需先 open 项目，从上下文读取设置
    - Standalone 模式: 通过 --manifest 指定清单文件，不依赖项目上下文
    """

    def __init__(self) -> None:
        super().__init__("validate", aliases=["check"])

    @property
    def description(self) -> str:
        return "执行数据验证，可指定表名或验证全部"

    @property
    def usage(self) -> str:
        return (
            "validate [table_name]\n"
            "  validate --manifest <path> [--data-directory <path>] [--table <name>] "
            "[--format human|json] [--report <path>]"
        )

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行数据校验命令。

        自动检测工作模式:
        - 如果 args 中包含 --manifest/-m，进入 standalone 模式
        - 否则进入 Shell 模式（要求已 open 项目）

        Args:
            args: 命令参数列表
            context: 项目上下文

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

    def _execute_shell(self, args: list[str], context: ProjectContext) -> CommandResult:
        """Shell 模式执行校验。

        从项目上下文中读取路径和设置，执行校验。

        Args:
            args: 命令参数列表，可能包含表名
            context: 命令上下文，必须包含已打开的项目

        Returns:
            校验结果
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        # 表名过滤来源优先级：--table/-t 选项 > 首个位置参数 > None（校验全部）
        # 位置参数须先剥离选项及选项值，否则 `validate --table users` 会把 "--table" 当表名
        parsed_shell = _parse_standalone_args(args)
        positional = _split_positional_args(args)
        table_name = parsed_shell["table"] or (positional[0] if positional else None)

        # 构建清单文件和数据目录路径
        manifest_path = os.path.join(project_path, "project.precis.yaml")
        data_dir = project_path

        # 从项目配置中读取设置
        validation_settings = context.project_config.get("validation", {}) if context.project_config else {}
        script_security = context.project_config.get("script_security", {}) if context.project_config else {}

        return self._run_validation(
            manifest_path,
            data_dir,
            table_name,
            validation_settings,
            script_security,
            # 契约：--format 仅 standalone 模式生效，Shell/REPL 一律 human 输出
            "human",
            parsed_shell["report"],
        )

    def _execute_standalone(self, parsed: dict) -> CommandResult:
        """Standalone 模式执行校验。

        直接从命令行参数获取路径，不依赖项目上下文。
        使用默认设置（timeout=30, 安全沙箱）。

        Args:
            parsed: 解析后的参数字典，包含 manifest/data_directory/table/format/report

        Returns:
            校验结果
        """
        # 输出格式：--format 缺省为 human（与历史行为完全一致），仅 standalone 模式生效
        output_format = (parsed["format"] or "human").strip().lower()
        if output_format not in _FORMAT_CHOICES:
            return CommandResult.error(
                f"--format 仅支持 {' 或 '.join(_FORMAT_CHOICES)}，收到: {parsed['format']}",
                exit_code=2,
            )

        manifest_path = os.path.abspath(parsed["manifest"])

        if not os.path.exists(manifest_path):
            return CommandResult.error(f"清单文件不存在: {manifest_path}", exit_code=2)
        if os.path.isdir(manifest_path):
            # 指向目录时 open() 在 Windows 抛 PermissionError、Linux 抛 IsADirectoryError，
            # 消息均误导排障方向（"权限"而非"这是目录"）——前置判明
            return CommandResult.error(
                f"清单路径是一个目录，请指向项目清单文件（project.precis.yaml）: {manifest_path}",
                exit_code=2,
            )

        # 数据目录：显式指定 > 清单文件所在目录
        if parsed["data_directory"]:
            data_dir = os.path.abspath(parsed["data_directory"])
        else:
            data_dir = os.path.dirname(manifest_path)

        if not os.path.isdir(data_dir):
            return CommandResult.error(f"数据目录不存在: {data_dir}", exit_code=2)

        table_name = parsed["table"]

        # standalone 模式使用默认设置
        return self._run_validation(manifest_path, data_dir, table_name, {}, {}, output_format, parsed["report"])

    def _run_validation(
        self,
        manifest_path: str,
        data_dir: str,
        table_name: str | None,
        validation_settings: dict,
        script_security: dict,
        output_format: str = "human",
        report_path: str | None = None,
    ) -> CommandResult:
        """执行校验的核心逻辑，Shell 和 Standalone 模式共享。

        Args:
            manifest_path: 清单文件路径
            data_dir: 数据目录路径
            table_name: 可选的表名过滤
            validation_settings: 校验设置字典
            script_security: 脚本安全设置字典
            output_format: 输出格式，"human"（rich 人类可读，默认）或 "json"
                （stdout 仅输出单个 JSON 文档，供 agent/CI 消费）
            report_path: 可选的报告输出路径（.html/.xlsx，按扩展名分派；
                与 --format json 可同时使用，报告与 JSON 内容同源）

        Returns:
            校验结果

        Raises:
            ValidationError: 当校验过程中发生异常时抛出
        """
        # 配置自检（inspect_config）在 load_project 内部执行，会通过 logger
        # 向 stderr 输出 "WARNING: [配置自检] ..." 噪声行。这些问题的详情已通过
        # loading_errors 结构化返回并在下方"加载警告"区展示，日志行属重复噪声。
        # 校验期间临时调高 inspector logger 级别以抑制日志，结束后在 finally 恢复。
        import logging

        inspector_logger = logging.getLogger("app.shared.core.project.loader.loader_parts.config_inspector")
        _prev_level = inspector_logger.level
        inspector_logger.setLevel(logging.ERROR)

        try:
            from app.shared.services.validation.executor import ValidationExecutor, ValidationOptions

            timeout_seconds = int(validation_settings.get("timeout_seconds", 30))
            if timeout_seconds <= 0:
                timeout_seconds = 30

            # 脚本执行权限：显式传入时优先使用传入值，否则回退到项目配置
            allow_eval = script_security.get("allow_eval")
            allow_exec = script_security.get("allow_exec")
            if allow_eval is None and allow_exec is None:
                allow_unsafe_eval = None
            else:
                allow_unsafe_eval = bool(allow_eval or allow_exec)

            options = ValidationOptions(
                timeout_seconds=timeout_seconds,
                allow_unsafe_eval=allow_unsafe_eval,
                table_filter=table_name,
                # C6 遇错即停:从项目配置读 error_handling(stop 时发现首个错误即停止)
                error_handling=validation_settings.get("error_handling", "continue"),
            )

            executor = ValidationExecutor(manifest_path)

            # JSON 模式下抑制全部人类可读输出（header/Spinner/摘要/结果），
            # 保证 stdout 只含单个 JSON 文档
            json_mode = output_format == "json"

            spinner: Spinner | None = None if json_mode else Spinner("正在校验数据")
            if spinner is not None:
                Formatter.print_header("开始执行数据校验")
                spinner.start()

            try:
                result = executor.execute(data_dir, options)
            finally:
                if spinner is not None:
                    spinner.stop(success=True)

            errors = result.get("errors", [])
            duration_ms = result.get("duration_ms", 0)

            if json_mode:
                payload = _build_json_payload(result)
                # --report 与 --format json 可并用；提示走 stderr 保持 stdout 纯 JSON。
                # 2026-09-20 契约修复：导出失败不再提前 return 留空 stdout——契约要求
                # stdout 始终输出单个 JSON 文档（docs/contracts/validate-json-v1.md），
                # 改为 payload 照常输出 + 错误经 stderr 透出 + 退出码维持 2
                report_note = self._export_report_if_requested(payload, report_path)
                report_failure: CommandResult | None = None
                if isinstance(report_note, CommandResult):
                    report_failure = report_note
                elif report_note:
                    print(report_note, file=sys.stderr)
                # stdout 只输出 JSON 文档（UTF-8，ensure_ascii=False 保留中文原文）
                print(json.dumps(payload, ensure_ascii=False))
                if report_failure is not None:
                    # 错误文案由调用方（单发模式 main / REPL 渲染器）按 CommandResult 呈现，
                    # 此处不再重复 print，避免 stderr 出现两条相同消息
                    return report_failure
                if errors:
                    return CommandResult.error("", data={"errors": errors, "duration_ms": duration_ms})
                return CommandResult.ok("", data={"errors": [], "duration_ms": duration_ms})

            # 处理并显示加载阶段的警告信息
            # loading_errors 来自 LoadingError.to_dict()，友好信息在 title/description/fix_hint
            # 字段（message 可能为空，如 inspect 级错误），故优先展示 title 等字段。
            loading_errors = result.get("loading_errors", [])
            if loading_errors:
                _console.print("\n[yellow]加载警告:[/yellow]")
                for err in loading_errors:
                    error_type = err.get("error_type", "Unknown")
                    title = err.get("title") or err.get("message") or ""
                    _console.print(f"  - [{error_type}] {title}")
                    if err.get("description"):
                        _console.print(f"     说明: {err['description']}")
                    if err.get("fix_hint"):
                        _console.print(f"     建议: {err['fix_hint']}")

            interrupted = result.get("interrupted", False)

            # C6 遇错即停:中断时提示用户剩余校验未执行(区别于正常完成)
            if interrupted:
                _console.print(f"\n⚠ 校验已停止（遇错即停），耗时: {duration_ms} ms")
                _console.print("  发现首个错误即停止，剩余检查未执行。调整 error_handling 可跑完全部。")
            else:
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

            # human 模式同样支持 --report（内容与 JSON 契约同源）
            report_note = self._export_report_if_requested(_build_json_payload(result), report_path)
            if isinstance(report_note, CommandResult):
                return report_note
            if report_note:
                _console.print(report_note)

            if errors:
                return CommandResult.error("", data={"errors": errors, "duration_ms": duration_ms})
            else:
                return CommandResult.ok("", data={"errors": [], "duration_ms": duration_ms})

        except Exception as e:
            raise ValidationError(str(e))
        finally:
            inspector_logger.setLevel(_prev_level)

    @staticmethod
    def _export_report_if_requested(payload: dict, report_path: str | None) -> str | CommandResult:
        """按需导出报告文件。

        Args:
            payload: JSON 契约 payload（报告内容与 stdout JSON 同源）
            report_path: --report 给出的输出路径；None 表示未请求

        Returns:
            成功时返回提示文案（调用方决定走 stdout/stderr）；
            未请求时返回空串；失败时返回 exit_code=2 的 CommandResult
        """
        if not report_path:
            return ""
        from app.shared.services.validation.report_export import export_report

        try:
            written = export_report(payload, report_path)
        except (ValueError, OSError) as e:
            return CommandResult.error(f"报告导出失败: {e}", exit_code=2)
        return f"报告已写入: {written}"
