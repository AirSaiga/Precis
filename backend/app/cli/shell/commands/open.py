# backend/app/cli/shell/commands/open.py
"""
@fileoverview CLI Shell 打开项目命令模块

功能概述:
- 提供 open 命令：打开并切换工作项目，维护项目历史记录
- 管理项目打开历史（持久化到 ~/.precis_project_history）

架构设计:
- OpenCommand 作为顶层命令注册，同时被 ProjectCommand 复用为子命令
- 历史记录与项目打开的纯逻辑委托给 shared_services.project_ops（CLI/TUI 同源）
- 本模块只保留交互部分（InteractiveMenu 历史选择）与命令编排
- 错误处理通过 CommandResult.error 直接返回，不抛出异常

输入示例:
    open /path/to/project
    project open /path/to/project

输出示例:
    CommandResult(success=True, message="已切换到项目: /path/to/project")
"""

import os

from app.cli.shared_services import project_ops
from app.cli.shell.commands.base import Command, CommandResult, ProjectContext

# 向后兼容 re-export：历史代码与集成测试通过 open 模块访问历史函数与常量。
# 真正的实现已迁移到 shared_services.project_ops（CLI/TUI 同源）。
HISTORY_FILE = project_ops.HISTORY_FILE
MAX_HISTORY = project_ops.MAX_HISTORY
_load_history = project_ops.load_history
_save_history = project_ops._save_history
_add_to_history = project_ops.add_to_history


class OpenCommand(Command):
    """打开项目命令。

    支持三种调用方式：
        open               → 从历史记录交互选择（箭头/数字键，Enter=最近项目）
        open <N>           → 打开历史列表第 N 个项目（1-based）
        open <项目路径>     → 按路径打开项目

    打开成功后更新上下文（project_path/project_config）并写入历史记录。
    """

    def __init__(self):
        super().__init__("open", aliases=["o"])

    @property
    def description(self) -> str:
        return "打开一个项目目录并切换当前上下文（无参数从历史选择）"

    @property
    def usage(self) -> str:
        return "open [项目路径 | 序号]（无参数则从历史选择）"

    def execute(self, args: list[str], ctx: ProjectContext) -> CommandResult:
        """执行打开项目命令。

        支持三种调用方式：
            open                 → 方案A：无参数，从历史记录交互选择
            open <N>             → 方案B：打开历史列表第 N 个项目（1-based）
            open <项目路径>       → 按路径打开项目

        Args:
            args: 命令参数列表
            ctx: 项目上下文，用于保存当前项目路径

        Returns:
            命令执行结果
        """
        # 方案A：无参数 → 交互式从历史选择
        if not args:
            return self._open_from_history(ctx)

        # 方案B：纯数字参数 → 按历史序号打开（拦截在路径解析之前，
        # 避免 "1" 被当成名为 "1" 的路径；真有同名目录可用 open ./1 绕过）
        if args[0].isdigit():
            return self._open_by_index(args[0], ctx)

        # 默认：按路径打开
        return self._do_open_path(os.path.abspath(args[0]), ctx)

    def _do_open_path(self, project_path: str, ctx: ProjectContext) -> CommandResult:
        """按绝对路径打开项目的公共逻辑（供方案A/B/路径模式复用）。

        委托 shared_services.project_ops.open_project 执行纯逻辑（存在性校验 +
        写历史 + 加载清单），再更新 CLI 上下文。

        Args:
            project_path: 项目目录的绝对路径
            ctx: 命令上下文

        Returns:
            命令执行结果
        """
        result = project_ops.open_project(project_path)
        if result.success:
            # 更新上下文中的项目路径与配置
            ctx.project_path = result.project_path
            ctx.project_config = result.config
        return CommandResult(success=result.success, message=result.message)

    def _open_from_history(self, ctx: ProjectContext) -> CommandResult:
        """方案A：无参数时从历史记录交互选择项目。

        使用 InteractiveMenu 渲染历史项目列表（光标默认停在最近项目，
        直接 Enter 即可打开上次项目）。空历史或取消时返回提示，不报错。

        Args:
            ctx: 命令上下文

        Returns:
            命令执行结果
        """
        # 延迟导入：InteractiveMenu 依赖 readchar，仅在交互分支才需要
        from app.cli.shell.interactive_menu import InteractiveMenu

        history = project_ops.load_history()
        if not history:
            return CommandResult(
                success=True,
                message="暂无项目打开历史。请先使用 'open <项目路径>' 打开一个项目。",
            )

        # 构建菜单项：key=项目路径，label=项目名（优先 manifest，否则目录名），description=完整路径
        menu = InteractiveMenu("从历史记录中选择项目:", show_cancel=True)
        for item in history:
            path = item.get("path", "")
            if not path:
                continue
            label = project_ops.resolve_project_label(path)
            menu.add_item(key=path, label=label, description=path)

        if not menu.items:
            return CommandResult(
                success=True,
                message="历史记录中无有效项目路径。请使用 'open <项目路径>' 打开项目。",
            )

        selected_path = menu.show()
        if selected_path is None:
            # 用户取消（ESC / 0 / 选了取消项）
            return CommandResult(success=True, message="已取消。")

        return self._do_open_path(selected_path, ctx)

    def _open_by_index(self, index_str: str, ctx: ProjectContext) -> CommandResult:
        """方案B：按历史序号打开项目（1-based）。

        Args:
            index_str: 用户输入的纯数字字符串
            ctx: 命令上下文

        Returns:
            命令执行结果
        """
        history = project_ops.load_history()
        if not history:
            return CommandResult(
                success=False,
                message="暂无项目打开历史，无法按序号打开。请使用 'open <项目路径>' 打开项目。",
            )

        # 解析序号（已在 execute 中确认 isdigit()，此处再防御一次）
        try:
            index = int(index_str)
        except ValueError:
            return CommandResult(success=False, message=f"无效的序号: {index_str}")

        if index < 1 or index > len(history):
            return CommandResult(
                success=False,
                message=f"无此历史项: {index}（共 {len(history)} 项，使用 'project history' 查看列表）",
            )

        path = history[index - 1].get("path", "")
        if not path:
            return CommandResult(success=False, message=f"历史项 {index} 缺少路径信息")

        return self._do_open_path(path, ctx)


__all__ = ["OpenCommand"]
