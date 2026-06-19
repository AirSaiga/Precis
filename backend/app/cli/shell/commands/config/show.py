# backend/app/cli/shell/commands/config/show.py
"""
@fileoverview 配置显示命令模块

功能概述:
- 提供 config show 子命令显示项目配置文件内容
- 支持单文件显示与默认配置文件批量显示
- 使用 YAML 格式化输出

架构设计:
- ConfigShowCommand 继承 Command 基类
- 指定文件时调用 _show_single_file() 显示单个文件
- 未指定时显示一组默认配置文件的内容

输入示例:
    config show
    config show project.precis.yaml

输出示例:
    格式化的 YAML 配置内容
"""

import os

import yaml

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.commands.config.base import find_config_file
from app.cli.shell.formatter import Formatter


class ConfigShowCommand(Command):
    """显示配置命令。

    显示项目配置文件的内容，支持单文件或批量显示。
    """

    def __init__(self):
        super().__init__("show")

    @property
    def description(self) -> str:
        return "显示当前项目的配置文件内容"

    @property
    def usage(self) -> str:
        return "config show [config_file]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行显示配置命令。

        Args:
            args: 命令参数列表，可能包含要显示的文件名
            context: 项目上下文

        Returns:
            配置文件内容或错误提示
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        # 如果指定了具体文件，只显示该文件
        if args:
            config_file = args[0]
            config_path = find_config_file(project_path, config_file)
            if not config_path:
                return CommandResult.error(f"配置文件不存在: {config_file}")
            # 显示相对路径
            rel_path = os.path.relpath(config_path, project_path)
            return self._show_single_file(config_path, rel_path)

        # 否则显示所有配置文件
        config_files = [
            "project.precis.yaml",
            "constraints.yaml",
            "patterns.yaml",
            "regex.yaml",
        ]

        output_lines = [Formatter.header("\n项目配置文件:")]

        for config_file in config_files:
            config_path = os.path.join(project_path, config_file)
            if os.path.isfile(config_path):
                output_lines.append(f"\n{Formatter.info('--- ' + config_file + ' ---')}")
                try:
                    with open(config_path, encoding="utf-8") as f:
                        content = yaml.safe_load(f)
                        if content:
                            output_lines.append(yaml.dump(content, allow_unicode=True, default_flow_style=False))
                        else:
                            output_lines.append("(空文件)")
                except Exception as e:
                    output_lines.append(f"(读取失败: {e})")

        return CommandResult.ok("\n".join(output_lines))

    def _show_single_file(self, config_path: str, config_file: str) -> CommandResult:
        """显示单个配置文件。

        Args:
            config_path: 文件的完整路径
            config_file: 用于显示的相对路径

        Returns:
            文件内容或错误提示
        """
        try:
            with open(config_path, encoding="utf-8") as f:
                content = yaml.safe_load(f)

            output_lines = [
                Formatter.header(f"\n{config_file}"),
                yaml.dump(content, allow_unicode=True, default_flow_style=False),
            ]
            return CommandResult.ok("\n".join(output_lines))
        except yaml.YAMLError as e:
            return CommandResult.error(f"YAML 解析失败: {e}")
        except Exception as e:
            return CommandResult.error(f"读取失败: {e}")
