# backend/app/cli/shell/commands/config/init.py
"""
@fileoverview 配置初始化命令模块

功能概述:
- 提供 config init 子命令基于模板创建新配置文件
- 支持 project、constraint、pattern 三种模板类型
- 自动使用项目名称填充模板变量

架构设计:
- ConfigInitCommand 继承 Command 基类
- 使用字典映射模板类型到 (默认文件名, 模板内容)
- 检查文件是否已存在，避免意外覆盖

输入示例:
    config init project
    config init constraint my_constraints.yaml

输出示例:
    CommandResult.ok("已创建配置文件: project.precis.yaml")
    CommandResult.error("文件已存在: project.precis.yaml")
"""

import os

from app.cli.shell.commands.base import Command, CommandResult, ProjectContext
from app.cli.shell.commands.config.base import CONSTRAINT_TEMPLATE, PATTERNS_TEMPLATE, PROJECT_TEMPLATE


class ConfigInitCommand(Command):
    """初始化配置命令。

    基于内置模板创建新的配置文件。
    """

    def __init__(self):
        super().__init__("init")

    @property
    def description(self) -> str:
        return "初始化新的配置文件"

    @property
    def usage(self) -> str:
        return "config init <project|constraint|pattern> [filename]"

    def execute(self, args: list[str], context: ProjectContext) -> CommandResult:
        """执行初始化配置命令。

        Args:
            args: 命令参数列表，第一个为模板类型，第二个可选为文件名
            context: 项目上下文

        Returns:
            创建成功或失败的结果
        """
        project_path = context.project_path
        if project_path is None:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        if not args:
            return CommandResult.error(
                "请指定模板类型: project, constraint, pattern\n用法: config init <type> [filename]"
            )

        template_type = args[0].lower()

        # 模板类型映射：类型 -> (默认文件名, 模板内容)
        templates = {
            "project": ("project.precis.yaml", PROJECT_TEMPLATE),
            "constraint": ("constraints.yaml", CONSTRAINT_TEMPLATE),
            "pattern": ("patterns.yaml", PATTERNS_TEMPLATE),
            "patterns": ("patterns.yaml", PATTERNS_TEMPLATE),
        }

        if template_type not in templates:
            return CommandResult.error(f"未知模板类型: {template_type}\n可用类型: project, constraint, pattern")

        default_filename, template = templates[template_type]

        # 使用指定的文件名或默认文件名
        filename = args[1] if len(args) > 1 else default_filename
        filepath = os.path.join(project_path, filename)

        # 检查文件是否已存在
        if os.path.exists(filepath):
            return CommandResult.error(f"文件已存在: {filename}\n如需覆盖，请先删除原文件")

        # 生成文件内容（使用项目名称填充模板变量）
        project_name = os.path.basename(project_path)
        content = template.format(project_name=project_name)

        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            return CommandResult.ok(f"已创建配置文件: {filename}")
        except Exception as e:
            return CommandResult.error(f"创建文件失败: {e}")
