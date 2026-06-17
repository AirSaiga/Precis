# backend/app/cli/shell/commands/config/__init__.py
"""
@fileoverview CLI Shell 配置管理命令模块入口

功能概述:
- 提供 config 命令聚合配置相关子命令
- 支持 show、edit、list、init、get、set、check 子命令分发

架构设计:
- ConfigCommand 作为聚合命令，包含多个子命令实例
- 使用字典映射子命令名到实例，实现快速分发
- execute() 方法负责参数校验和子命令路由

输入示例:
    config show
    config get project.precis.yaml project.name

输出示例:
    子命令的执行结果
"""

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.commands.config.check import ConfigCheckCommand
from app.cli.shell.commands.config.edit import ConfigEditCommand
from app.cli.shell.commands.config.get import ConfigGetCommand
from app.cli.shell.commands.config.init import ConfigInitCommand
from app.cli.shell.commands.config.inspect import ConfigInspectCommand
from app.cli.shell.commands.config.list import ConfigListCommand
from app.cli.shell.commands.config.set import ConfigSetCommand
from app.cli.shell.commands.config.show import ConfigShowCommand


class ConfigCommand(Command):
    """配置管理命令。

    聚合所有配置相关的子命令，包括查看、编辑、列表、初始化、获取、设置、检查。
    """

    def __init__(self):
        super().__init__("config")
        self._show_cmd = ConfigShowCommand()
        self._edit_cmd = ConfigEditCommand()
        self._list_cmd = ConfigListCommand()
        self._init_cmd = ConfigInitCommand()
        self._get_cmd = ConfigGetCommand()
        self._set_cmd = ConfigSetCommand()
        self._check_cmd = ConfigCheckCommand()
        self._inspect_cmd = ConfigInspectCommand()

        # 注册子命令
        self.add_subcommand("show", self._show_cmd)
        self.add_subcommand("edit", self._edit_cmd)
        self.add_subcommand("list", self._list_cmd)
        self.add_subcommand("init", self._init_cmd)
        self.add_subcommand("get", self._get_cmd)
        self.add_subcommand("set", self._set_cmd)
        self.add_subcommand("check", self._check_cmd)
        self.add_subcommand("inspect", self._inspect_cmd)

    @property
    def description(self) -> str:
        return "管理项目配置文件"

    @property
    def usage(self) -> str:
        return "config <show|edit|list|init|get|set|check|inspect>"

    def execute(self, args: list, context: CommandContext) -> CommandResult:
        """执行配置管理命令。

        校验参数并分发给对应的子命令执行。

        Args:
            args: 命令参数列表，第一个元素为子命令名
            context: 命令上下文

        Returns:
            子命令执行结果或错误提示
        """
        if not args:
            return CommandResult.error(
                "请指定子命令: show, edit, list, init, get, set, check, inspect\n"
                "用法: config <subcommand> [options]\n\n"
                "子命令说明:\n"
                "  show    - 显示配置文件内容\n"
                "  edit    - 编辑配置文件\n"
                "  list    - 列出所有配置文件\n"
                "  init    - 初始化新配置文件\n"
                "  get     - 获取配置项值\n"
                "  set     - 设置配置项值\n"
                "  check   - 检查配置文件语法格式\n"
                "  inspect - 执行配置跨文件一致性自检"
            )

        subcommand = args[0]
        sub_args = args[1:]

        subcommands = {
            "show": self._show_cmd,
            "edit": self._edit_cmd,
            "list": self._list_cmd,
            "init": self._init_cmd,
            "get": self._get_cmd,
            "set": self._set_cmd,
            "check": self._check_cmd,
            "inspect": self._inspect_cmd,
        }

        if subcommand in subcommands:
            return subcommands[subcommand].execute(sub_args, context)
        else:
            return CommandResult.error(f"未知子命令: {subcommand}")


__all__ = ["ConfigCommand"]
