# backend/app/cli/shell/commands/config/get.py
"""
@fileoverview 配置获取命令模块

功能概述:
- 提供 config get 子命令按点号路径获取配置项值
- 支持字典与列表的 YAML 格式化输出
- 使用点号路径访问嵌套配置，如 project.name

架构设计:
- ConfigGetCommand 继承 Command 基类
- 按点号分割路径，逐级访问字典，遇到不存在的键则报错

输入示例:
    config get project.precis.yaml project.name

输出示例:
    CommandResult.ok("project.name = My Project")
    CommandResult.error("配置项不存在: project.unknown")
"""

import os

import yaml

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext


class ConfigGetCommand(Command):
    """获取配置项命令。

    按点号路径从 YAML 配置文件中读取指定项的值。
    """

    def __init__(self):
        super().__init__("get")

    @property
    def description(self) -> str:
        return "获取配置项的值（支持点号路径）"

    @property
    def usage(self) -> str:
        return "config get <config_file> <key_path>"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行获取配置项命令。

        Args:
            args: 命令参数列表，需要包含配置文件名和点号路径
            context: 项目上下文

        Returns:
            配置项值或错误提示
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        if len(args) < 2:
            return CommandResult.error(
                "用法: config get <config_file> <key_path>\n示例: config get project.precis.yaml project.name"
            )

        config_file = args[0]
        key_path = args[1]
        config_path = os.path.join(project_path, config_file)

        if not os.path.isfile(config_path):
            return CommandResult.error(f"配置文件不存在: {config_file}")

        try:
            with open(config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)

            if data is None:
                return CommandResult.error("配置文件为空")

            # 按点号路径查找值
            keys = key_path.split(".")
            value = data
            for key in keys:
                if isinstance(value, dict) and key in value:
                    value = value[key]
                else:
                    return CommandResult.error(f"配置项不存在: {key_path}")

            # 格式化输出
            if isinstance(value, (dict, list)):
                formatted = yaml.dump(value, allow_unicode=True, default_flow_style=False)
            else:
                formatted = str(value)

            return CommandResult.ok(f"{key_path} = {formatted}")

        except yaml.YAMLError as e:
            return CommandResult.error(f"YAML 解析失败: {e}")
        except Exception as e:
            return CommandResult.error(f"读取失败: {e}")
