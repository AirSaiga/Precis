# backend/app/cli/shell/commands/config/set.py
"""
@fileoverview 配置设置命令模块

功能概述:
- 提供 config set 子命令按点号路径设置配置项值
- 支持布尔值、整数、浮点数、列表、字典与字符串的自动类型解析
- 保留 YAML 格式，支持 Unicode

架构设计:
- ConfigSetCommand 继承 Command 基类
- _parse_value(): 自动推断值的类型（bool -> int -> float -> yaml -> str）
- 按点号路径逐层创建字典，最后设置值

输入示例:
    config set project.precis.yaml project.name "My Project"
    config set project.precis.yaml validation.auto_validate true

输出示例:
    CommandResult.ok("已设置: project.name = My Project")
    CommandResult.error("配置文件不存在: project.precis.yaml")
"""

import os

import yaml

from app.cli.shared_services.config_ops import parse_config_value, set_by_dotpath
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext


class ConfigSetCommand(Command):
    """设置配置项命令。

    按点号路径设置 YAML 配置文件中指定项的值。
    """

    def __init__(self):
        super().__init__("set")

    @property
    def description(self) -> str:
        return "设置配置项的值（支持点号路径）"

    @property
    def usage(self) -> str:
        return "config set <config_file> <key_path> <value>"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行设置配置项命令。

        Args:
            args: 命令参数列表，需要包含文件名、路径和值
            context: 项目上下文

        Returns:
            设置成功或失败的结果
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        if len(args) < 3:
            return CommandResult.error(
                "用法: config set <config_file> <key_path> <value>\n"
                '示例: config set project.precis.yaml project.name "My Project"'
            )

        config_file = args[0]
        key_path = args[1]
        value_str = args[2]
        config_path = os.path.join(project_path, config_file)

        if not os.path.isfile(config_path):
            return CommandResult.error(f"配置文件不存在: {config_file}")

        try:
            with open(config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            # 解析值（委托 shared_services 纯逻辑，CLI/TUI 同源）
            # parse_config_value 始终成功返回三元组，行为与原 _parse_value 一致
            value = parse_config_value(value_str)[1]

            # 按点号路径设置值（委托 shared_services 纯逻辑，返回新 dict 不改原 data）
            data = set_by_dotpath(data, key_path, value)

            # 写回文件
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

            return CommandResult.ok(f"已设置: {key_path} = {value}")

        except yaml.YAMLError as e:
            return CommandResult.error(f"YAML 解析失败: {e}")
        except Exception as e:
            return CommandResult.error(f"写入失败: {e}")
