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

import logging
import os
from typing import Any

import yaml

from app.cli.shell.commands.base import Command, CommandContext, CommandResult


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

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行设置配置项命令。

        Args:
            args: 命令参数列表，需要包含文件名、路径和值
            context: 命令上下文

        Returns:
            设置成功或失败的结果
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        if len(args) < 3:
            return CommandResult.error(
                "用法: config set <config_file> <key_path> <value>\n"
                '示例: config set project.precis.yaml project.name "My Project"'
            )

        config_file = args[0]
        key_path = args[1]
        value_str = args[2]
        project_path = context.project_path
        config_path = os.path.join(project_path, config_file)

        if not os.path.isfile(config_path):
            return CommandResult.error(f"配置文件不存在: {config_file}")

        try:
            with open(config_path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

            # 解析值（尝试转换为合适的类型）
            value = self._parse_value(value_str)

            # 按点号路径设置值
            keys = key_path.split(".")
            current = data
            for key in keys[:-1]:
                if key not in current:
                    current[key] = {}
                current = current[key]
            current[keys[-1]] = value

            # 写回文件
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

            return CommandResult.ok(f"已设置: {key_path} = {value}")

        except yaml.YAMLError as e:
            return CommandResult.error(f"YAML 解析失败: {e}")
        except Exception as e:
            return CommandResult.error(f"写入失败: {e}")

    def _parse_value(self, value_str: str) -> Any:
        """解析字符串值为合适的类型。

        按以下顺序尝试转换：
        1. 布尔值（true/false）
        2. null（null/none）
        3. 整数
        4. 浮点数
        5. 去除引号的字符串
        6. YAML 列表或字典
        7. 原样字符串

        Args:
            value_str: 原始字符串值

        Returns:
            转换后的 Python 对象
        """
        # 尝试布尔值
        if value_str.lower() == "true":
            return True
        if value_str.lower() == "false":
            return False
        if value_str.lower() == "null" or value_str.lower() == "none":
            return None

        # 尝试整数
        try:
            return int(value_str)
        except ValueError:
            logging.error("解析整数值失败", exc_info=True)

        # 尝试浮点数
        try:
            return float(value_str)
        except ValueError:
            logging.error("解析浮点数值失败", exc_info=True)

        # 去除引号
        if (value_str.startswith('"') and value_str.endswith('"')) or (
            value_str.startswith("'") and value_str.endswith("'")
        ):
            return value_str[1:-1]

        # 尝试 YAML 列表或对象
        try:
            parsed = yaml.safe_load(value_str)
            if isinstance(parsed, (list, dict)):
                return parsed
        except Exception:
            logging.error("解析YAML值失败", exc_info=True)

        # 默认返回字符串
        return value_str
