# backend/app/cli/shell/commands/ai/__init__.py
"""
@fileoverview CLI Shell AI 助手命令模块入口

功能概述:
- 提供 ai 命令聚合 AI 相关子命令
- 支持交互式菜单、对话、状态查看、Provider 切换等
- 支持直接通过自然语言执行 AI 指令

架构设计:
- AICommand 作为聚合命令，管理 chat、status、switch、delete、setup 等子命令
- 无参数时显示交互式菜单（支持方向键导航）
- 第一个参数如果不是子命令，则将其视为直接询问的消息
- 使用 execute_ai_chat 统一执行 AI 对话

输入示例:
    precis> ai
    precis> ai chat
    precis> ai status
    precis> ai ask "添加非空约束到 users 表的 email 列"

输出示例:
    交互式菜单或 AI 执行结果
"""

# 导入子命令
from app.cli.shell.commands.ai.chat import AIChatCommand
from app.cli.shell.commands.ai.delete import AIDeleteCommand
from app.cli.shell.commands.ai.executor import execute_ai_chat
from app.cli.shell.commands.ai.status import AIStatusCommand
from app.cli.shell.commands.ai.switch import AISwitchCommand
from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.commands.provider import ProviderCommand
from app.cli.shell.config_storage import get_cli_config
from app.cli.shell.formatter import Formatter
from app.cli.shell.interactive_menu import InteractiveMenu


class AICommand(Command):
    """AI 助手命令。

    支持交互式对话模式和直接执行 AI 指令。
    作为聚合命令，包含多个子命令和一个交互式菜单。
    """

    def __init__(self):
        super().__init__("ai", aliases=["assistant"])
        self._chat_cmd = AIChatCommand()
        self._status_cmd = AIStatusCommand()
        self._switch_cmd = AISwitchCommand()
        self._provider_cmd = ProviderCommand()
        self._delete_cmd = AIDeleteCommand()
        self._cli_config = get_cli_config()

        # 注册子命令
        self.add_subcommand("chat", self._chat_cmd)
        self.add_subcommand("status", self._status_cmd)
        self.add_subcommand("switch", self._switch_cmd)
        self.add_subcommand("delete", self._delete_cmd)
        self.add_subcommand("provider", self._provider_cmd)

    @property
    def description(self) -> str:
        return "AI 助手 - 使用自然语言修改项目配置"

    @property
    def usage(self) -> str:
        return "ai [chat|status|switch|provider|delete|ask <message>]"

    @property
    def help_text(self) -> str:
        return """
用法: ai [子命令] [参数]

子命令:
  chat              进入交互式 AI 对话模式
  ask <message>     直接执行 AI 指令（如: ai ask "添加非空约束到用户表的email字段"）
  status            显示 AI 配置状态
  switch <provider> 切换默认 AI Provider
  provider          管理 AI Provider（添加/编辑/删除/测试）
  delete [provider] 删除已配置的 Provider

示例:
  ai chat                           # 进入交互式对话
  ai ask "创建非空约束到users表的email列"   # 直接执行
  ai status                         # 查看 AI 配置状态
  ai switch kimi                    # 切换到 Kimi
  ai provider                       # 管理 AI Provider
  ai delete kimi                    # 删除 Kimi

说明:
  AI 助手可以帮你通过自然语言修改项目配置，包括：
  - 添加、更新、删除约束（NOT_NULL, UNIQUE, RANGE, ALLOWED_VALUES, REGEX）
  - 查看和解释当前配置

  首次使用请先运行 'ai provider' 命令添加 Provider
        """.strip()

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行 AI 命令。

        无参数时显示交互式菜单；
        有参数时根据子命令名分发给对应处理器；
        如果第一个参数不是已知子命令，则视为直接询问。

        Args:
            args: 命令参数列表
            context: 命令上下文

        Returns:
            子命令执行结果或 AI 对话结果
        """
        if not args:
            # 无参数时显示交互式菜单
            return self._show_interactive_menu(context)

        subcommand = args[0]
        sub_args = args[1:]

        if subcommand == "chat":
            return self._chat_cmd.execute(sub_args, context)
        elif subcommand == "ask":
            return self._ask_direct(sub_args, context)
        elif subcommand == "status":
            return self._status_cmd.execute(sub_args, context)
        elif subcommand == "switch":
            return self._switch_cmd.execute(sub_args, context)
        elif subcommand == "delete":
            return self._delete_cmd.execute(sub_args, context)
        elif subcommand == "provider":
            return self._provider_cmd.execute(sub_args, context)
        else:
            # 如果第一个参数不是子命令，则将其视为直接询问的消息
            return self._ask_direct(args, context)

    def _show_interactive_menu(self, context: CommandContext) -> CommandResult:
        """显示 AI 助手的交互式菜单（支持方向键导航）。

        循环显示菜单，直到用户选择退出或执行需要退出的子命令。

        Args:
            context: 命令上下文

        Returns:
            退出菜单后的结果
        """
        while True:
            status_lines = []

            # 构建状态行：显示当前 Provider 和项目
            provider = self._cli_config.get_active_provider()
            if provider:
                status_lines.append(Formatter.info(f"当前 Provider: {provider.name} ({provider.model})"))
            else:
                status_lines.append(Formatter.warning("[!] 未配置 AI Provider"))

            if context.is_project_open:
                project_name = context.project_config.get("project", {}).get("name", "project")
                status_lines.append(Formatter.info(f"当前项目: {project_name}"))
            else:
                status_lines.append(Formatter.warning("[!] 未打开项目"))

            # 创建交互式菜单
            menu = InteractiveMenu("AI 助手")
            menu.add_item("chat", "chat", "进入交互式对话模式")
            menu.add_item("status", "status", "查看 AI 配置状态")
            menu.add_item("switch", "switch", "切换 AI Provider")
            menu.add_item("provider", "provider", "管理 AI Provider")
            menu.add_item("delete", "delete", "删除 Provider")
            menu.add_item("help", "help", "显示帮助信息")

            choice = menu.show_with_status(status_lines)

            if choice is None:
                return CommandResult.ok("已退出 AI 助手")
            elif choice == "chat":
                result = self._chat_cmd.execute([], context)
                if result.should_exit:
                    return result
            elif choice == "status":
                result = self._status_cmd.execute([], context)
                print(result.message)
                input(Formatter.info("\n按回车键返回菜单..."))
            elif choice == "switch":
                self._switch_cmd.execute([], context)
            elif choice == "provider":
                self._provider_cmd.execute([], context)
            elif choice == "delete":
                self._delete_cmd.execute([], context)
            elif choice == "help":
                print(Formatter.info(self.help_text))
                input(Formatter.info("\n按回车键继续..."))

    def _ask_direct(self, args: list[str], context: CommandContext) -> CommandResult:
        """直接执行 AI 询问。

        将参数拼接为完整消息，调用 execute_ai_chat 非交互式执行。

        Args:
            args: 消息内容（按空格分割的数组）
            context: 命令上下文

        Returns:
            AI 对话执行结果
        """
        if not args:
            return CommandResult.error("请提供询问内容\n用法: ai ask <message> 或 ai <message>")

        message = " ".join(args)
        return execute_ai_chat(message, context, interactive=False)


__all__ = ["AICommand"]
