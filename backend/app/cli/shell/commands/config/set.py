# backend/app/cli/shell/commands/config/set.py
"""
@fileoverview 配置设置命令模块

功能概述:
- 提供 config set 子命令按点号路径设置配置项值
- 支持布尔值、整数、浮点数、列表、字典与字符串的自动类型解析
- 保留 YAML 注释与格式，原子写回，路径解析含穿越防护

架构设计:
- ConfigSetCommand 继承 Command 基类
- _parse_value(): 自动推断值的类型（bool -> int -> float -> yaml -> str），已收敛至
  shared_services 的 parse_config_value（CLI/TUI 同源）
- 文件定位/写入统一委托 shared_services 的 set_config_value_in_file：
  find_config_file 防路径穿越 + ruamel round-trip 仅替换目标键的值（保留注释）
  + 临时文件原子替换

输入示例:
    config set project.precis.yaml project.name "My Project"
    config set project.precis.yaml validation.auto_validate true

输出示例:
    CommandResult.ok("已设置: project.name = My Project")
    CommandResult.error("配置文件不存在: project.precis.yaml")
"""

from app.cli.shared_services.config_ops import parse_config_value, set_config_value_in_file
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

        # 解析值（委托 shared_services 纯逻辑，CLI/TUI 同源）
        # parse_config_value 始终成功返回三元组，行为与原 _parse_value 一致
        value = parse_config_value(value_str)[1]

        # 定位文件并写入（委托 shared_services，CLI/TUI 同源）：
        # - find_config_file 统一路径解析，含 .. / 绝对路径等穿越防护与递归回退
        # - ruamel round-trip 仅替换目标键的值，保留注释与格式
        # - 临时文件 + os.replace 原子写回，失败时不损坏原文件
        ok, error_message = set_config_value_in_file(project_path, config_file, key_path, value)
        if not ok:
            return CommandResult.error(error_message)

        return CommandResult.ok(f"已设置: {key_path} = {value}")
