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
from typing import Optional

import yaml

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.commands.config.base import find_config_file
from app.cli.shell.formatter import Formatter


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

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行配置检查命令。

        Args:
            args: 命令参数列表，可能包含文件名或 --all 标志
            context: 命令上下文

        Returns:
            检查结果，成功表示所有文件格式正确
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        project_path = context.project_path

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
        output_lines = [Formatter.header(f"\n发现 {invalid_count} 个配置文件格式错误:")]
        output_lines.extend(results)
        if show_all:
            output_lines.append(f"\n总计: {valid_count} 个有效, {invalid_count} 个无效")
        else:
            output_lines.append(f"\n（共检查 {valid_count + invalid_count} 个文件，使用 --all 查看全部）")

        return CommandResult.error("\n".join(output_lines))

    def _check_single_file(self, config_path: str, config_file: str) -> CommandResult:
        """检查单个文件，显示详细错误。

        Args:
            config_path: 文件的完整路径
            config_file: 用于显示的相对路径

        Returns:
            检查结果
        """
        result, error_msg = self._check_file(config_path)
        if result:
            return CommandResult.ok(f"✓ {config_file} 格式正确")
        else:
            output = f"✗ {config_file} 格式错误"
            if error_msg:
                output += f"\n\n错误详情:\n{error_msg}"
            return CommandResult.error(output)

    def _check_file(self, config_path: str) -> tuple[bool, Optional[str]]:
        """检查文件，返回 (是否有效, 错误信息)。

        Args:
            config_path: 文件的完整路径

        Returns:
            tuple: (bool, str|None) - 是否有效，错误信息（如果无效）
        """
        filename = os.path.basename(config_path)

        try:
            with open(config_path, encoding="utf-8") as f:
                content = f.read()

            # 尝试解析 YAML
            yaml.safe_load(content)
            return True, None

        except yaml.YAMLError as e:
            # YAML 语法错误，格式化友好的错误信息
            error_msg = self._format_yaml_error(e, filename, content)
            return False, error_msg

        except Exception as e:
            return False, f"读取文件失败: {e}"

    def _format_yaml_error(self, error: yaml.YAMLError, filename: str, content: str) -> str:
        """格式化 YAML 错误为友好的提示信息。

        Args:
            error: YAML 解析异常
            filename: 文件名
            content: 文件原始内容

        Returns:
            格式化的错误提示字符串
        """
        lines = []
        content_lines = content.split("\n")

        # 获取错误位置
        problem_mark = getattr(error, "problem_mark", None)
        if problem_mark:
            error_line_no = problem_mark.line  # 0-based
            error_col = problem_mark.column

            # 显示错误位置（1-based）
            lines.append(f"位置: 第 {error_line_no + 1} 行")

            # 显示上下文（前后2行）
            context_start = max(0, error_line_no - 2)
            context_end = min(len(content_lines), error_line_no + 3)

            lines.append("")
            lines.append("代码片段:")
            for i in range(context_start, context_end):
                line_num = i + 1
                line_content = content_lines[i]
                prefix = ">>>" if i == error_line_no else "   "
                lines.append(f"{prefix} {line_num:3d} | {line_content}")

                # 在错误行下方显示指示器
                if i == error_line_no:
                    indicator = " " * 8 + " " * error_col + "^"
                    lines.append(f"      {indicator}")
        else:
            lines.append("位置: 未知")

        # 错误描述
        if hasattr(error, "context") and error.context:
            context = self._simplify_error_message(error.context)
            lines.append("")
            lines.append(f"上下文: {context}")

        if hasattr(error, "problem") and error.problem:
            problem = self._simplify_error_message(error.problem)
            lines.append(f"问题: {problem}")

        # 添加建议
        problem_str = str(getattr(error, "problem", "")).lower()
        context_str = str(getattr(error, "context", "")).lower()

        if "block end" in problem_str and "scalar" in problem_str:
            lines.append("")
            lines.append("提示: 可能是上一行缺少冒号，或括号/引号不匹配")
            # 检查前一行的内容
            if error_line_no > 0:
                prev_line = content_lines[error_line_no - 1].strip()
                if "required" in prev_line and ":" not in prev_line:
                    lines.append(f"      上一行 '{prev_line[:30]}...' 可能缺少冒号")
        elif "mapping" in context_str:
            lines.append("")
            lines.append("提示: 检查键值对格式是否正确（key: value）")
        elif "could not determine a constructor" in problem_str:
            lines.append("")
            lines.append("提示: 可能包含特殊字符或不支持的 YAML 语法")

        return "\n".join(lines)

    def _simplify_error_message(self, msg: str) -> str:
        """将技术性的错误信息转换为更友好的描述。

        Args:
            msg: 原始错误信息

        Returns:
            翻译后的中文描述，如果没有匹配则返回原文
        """
        translations = {
            "expected '<document start>', but found": "期望文件开始标记，但实际发现",
            "expected <block end>, but found": "期望块结束，但实际发现",
            "expected ',' or ']', but got": "期望逗号或右括号，但实际得到",
            "while parsing a block mapping": "解析对象/字典时出错",
            "while parsing a block collection": "解析列表/数组时出错",
            "mapping values are not allowed here": "此处不允许键值对（可能缺少冒号或缩进错误）",
            "could not determine a constructor for the tag": "无法识别的标签类型",
            "found character": "发现不期望的字符",
            "that cannot start any token": "无法作为任何标记的开始",
            "unacceptable character": "包含不可接受的字符（可能是编码问题）",
        }

        for tech, friendly in translations.items():
            if tech.lower() in msg.lower():
                return friendly

        return msg
