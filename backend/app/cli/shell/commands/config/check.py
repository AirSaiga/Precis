# backend/app/cli/shell/commands/config/check.py
"""
@fileoverview 配置检查命令模块

功能概述:
- 提供 config check 子命令检查项目 YAML 配置文件语法
- 支持单文件检查与全项目扫描
- 格式化 YAML 语法错误为友好提示（显示行号、代码片段、建议）

架构设计:
- ConfigCheckCommand 继承 Command 基类
- execute() 根据参数决定单文件检查或全项目扫描
- _check_file(): 使用 yaml.safe_load 验证文件，返回 (是否有效, 错误信息)
- _format_yaml_error(): 将 YAML 解析错误转换为友好的中文提示

输入示例:
    config check
    config check project.precis.yaml
    config check --all

输出示例:
    CommandResult.ok("✓ 所有 5 个配置文件格式正确")
    CommandResult.error("发现 2 个配置文件格式错误: ...")
"""

import os

from rich.console import Console
from rich.syntax import Syntax

from app.cli.shared_services.config_ops import YamlCheckResult, check_yaml_syntax
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.commands.config.base import find_config_file
from app.cli.shell.formatter import _supports_unicode

_CHECK_MARK = "\u2713" if _supports_unicode() else "[OK]"
_CROSS_MARK = "\u2717" if _supports_unicode() else "[FAIL]"

_console = Console()


class ConfigCheckCommand(Command):
    """检查配置命令。

    验证项目中的 YAML 配置文件语法是否正确。
    """

    def __init__(self):
        super().__init__("check")

    @property
    def description(self) -> str:
        return "检查配置文件的语法格式"

    @property
    def usage(self) -> str:
        return "config check [config_file] [--all]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行配置检查命令。

        Args:
            args: 命令参数列表，可能包含文件名或 --all 标志
            context: 项目上下文

        Returns:
            检查结果，成功表示所有文件格式正确
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        # 解析参数
        show_all = "--all" in args
        if show_all:
            args = [a for a in args if a != "--all"]

        # 如果指定了文件，只验证该文件
        if args:
            config_file = args[0]
            config_path = find_config_file(project_path, config_file)

            if not config_path:
                return CommandResult.error(f"配置文件不存在: {config_file}")

            # 显示相对路径
            rel_path = os.path.relpath(config_path, project_path)
            return self._check_single_file(config_path, rel_path)

        # 否则验证所有 YAML 文件
        all_files = []
        for root, _, files in os.walk(project_path):
            # 跳过隐藏目录
            if any(part.startswith(".") for part in root.split(os.sep)):
                continue
            for f in files:
                if f.endswith((".yaml", ".yml")):
                    rel_path = os.path.relpath(os.path.join(root, f), project_path)
                    all_files.append(rel_path)

        results = []
        valid_count = 0
        invalid_count = 0

        for config_file in sorted(all_files):
            config_path = os.path.join(project_path, config_file)
            result, error_msg = self._check_file(config_path)
            if result:
                valid_count += 1
                if show_all:
                    results.append(f"✓ {config_file}")
            else:
                invalid_count += 1
                results.append(f"✗ {config_file}")
                if error_msg:
                    # 显示简化的错误信息（位置和问题）
                    error_lines = error_msg.split("\n")
                    # 提取位置行、代码片段、问题行
                    for line in error_lines:
                        if line.startswith("位置:") or line.startswith("问题:") or line.startswith("提示:"):
                            results.append(f"    {line}")
                        # 显示代码片段的指示行（包含 >>> 的那一行）
                        elif ">>>" in line:
                            results.append(f"    {line}")
                            # 也显示下一行（箭头）
                            idx = error_lines.index(line)
                            if idx + 1 < len(error_lines) and "^" in error_lines[idx + 1]:
                                results.append(f"    {error_lines[idx + 1]}")

        if invalid_count == 0:
            return CommandResult.ok(f"✓ 所有 {valid_count} 个配置文件格式正确")

        # 有错误时只显示错误文件（除非指定 --all）
        output_lines = [f"[bold]\n发现 {invalid_count} 个配置文件格式错误:[/bold]"]
        output_lines.extend(results)
        if show_all:
            output_lines.append(f"\n总计: {valid_count} 个有效, {invalid_count} 个无效")
        else:
            output_lines.append(f"\n（共检查 {valid_count + invalid_count} 个文件，使用 --all 查看全部）")

        return CommandResult.error("\n".join(output_lines))

    def _check_single_file(self, config_path: str, config_file: str) -> CommandResult:
        result, error_msg = self._check_file(config_path)
        if result:
            return CommandResult.ok(f"{_CHECK_MARK} {config_file} 格式正确")
        else:
            output = f"{_CROSS_MARK} {config_file} 格式错误"
            if error_msg:
                output += f"\n\n错误详情:\n{error_msg}"
            return CommandResult.error(output)

    def _check_file(self, config_path: str) -> tuple[bool, str | None]:
        """检查文件，返回 (是否有效, 错误信息)。

        语法检查与错误收集委托 shared_services.check_yaml_syntax（纯逻辑），
        rich.Syntax 高亮等渲染留在本类 _render_yaml_error。

        Args:
            config_path: 文件的完整路径

        Returns:
            tuple: (bool, str|None) - 是否有效，错误信息（如果无效）
        """
        filename = os.path.basename(config_path)

        try:
            with open(config_path, encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            return False, f"读取文件失败: {e}"

        # 语法检查 + 错误收集委托 shared_services（CLI/TUI 同源）
        result = check_yaml_syntax(content, filename)
        if result.valid:
            return True, None
        # 渲染部分留在 CLI 层（rich.Syntax 高亮是 CLI 专属 UI）
        return False, self._render_yaml_error(result, content)

    def _render_yaml_error(self, result: YamlCheckResult, content: str) -> str:
        """渲染 YAML 检查结果为友好提示（CLI 专属 UI）。

        纯逻辑（错误位置/问题/建议收集）已由 shared_services.check_yaml_syntax 完成，
        本方法只负责 rich.Syntax 高亮与文本拼接。

        Args:
            result: check_yaml_syntax 返回的纯逻辑结果
            content: 文件原始内容（用于 rich.Syntax 高亮取行）

        Returns:
            格式化的错误提示字符串
        """
        lines: list[str] = []
        content_lines = content.split("\n")

        # 位置
        if result.line_no is not None:
            lines.append(f"位置: 第 {result.line_no} 行")

            # 使用 rich.syntax 高亮代码片段（行号 0-based 用于 highlight_lines）
            error_line_no = result.line_no - 1  # 转回 0-based
            context_start = max(0, error_line_no - 2)
            context_end = min(len(content_lines), error_line_no + 3)
            snippet = "\n".join(content_lines[context_start:context_end])
            start_line = context_start + 1

            lines.append("")
            lines.append("代码片段:")
            syntax = Syntax(
                snippet,
                "yaml",
                start_line=start_line,
                line_numbers=True,
                highlight_lines={error_line_no + 1},
                theme="monokai",
            )
            with _console.capture() as capture:
                _console.print(syntax)
            lines.append(capture.get())
        else:
            lines.append("位置: 未知")

        # 问题（已由 check_yaml_syntax 简化，可能含上下文）
        if result.problem:
            lines.append(f"问题: {result.problem}")

        # 修复建议
        if result.hint:
            lines.append("")
            lines.append(f"提示: {result.hint}")

        return "\n".join(lines)
