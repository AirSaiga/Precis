# backend/app/cli/shell/commands/config/inspect.py
"""
@fileoverview 配置自检命令模块

功能概述:
- 提供 config inspect 子命令，执行项目配置的跨文件一致性自检
- 复用后端 inspect_config 检查引擎（ID 一致性、引用完整性、数据源冲突等）
- 将检查结果格式化为友好的 CLI 输出（按严重度分组、显示修复建议）

架构设计:
- ConfigInspectCommand 继承 Command 基类
- 通过 load_project() 加载项目（内部已执行 inspect_config，结果在 loading_errors）
- _format_report(): 将 LoadingError 列表格式化为可读文本

输入示例:
    config inspect

输出示例:
    CommandResult.ok("✓ 配置自检通过，未发现问题")
    CommandResult.error("配置自检发现 3 个问题:\n...")
"""

from __future__ import annotations

from app.cli.shell.commands.base import Command, CommandContext, CommandResult
from app.cli.shell.formatter import _supports_unicode
from app.shared.core.project.loader.loader_parts.main import load_project
from app.shared.core.project.loader.types import LoadingError

_CHECK_MARK = "\u2713" if _supports_unicode() else "[OK]"
_CROSS_MARK = "\u2717" if _supports_unicode() else "[FAIL]"

# 严重度展示符号与标签
_SEVERITY_DISPLAY = {
    "blocker": ("🔴", "阻塞"),
    "warning": ("⚠️", "警告"),
    "info": ("ℹ️", "提示"),
}


class ConfigInspectCommand(Command):
    """配置自检命令。

    执行项目配置的跨文件一致性检查，复用后端 inspect_config 引擎。
    """

    def __init__(self):
        super().__init__("inspect")

    @property
    def description(self) -> str:
        return "执行配置文件跨文件一致性自检（ID 一致性、引用完整性、数据源冲突）"

    @property
    def usage(self) -> str:
        return "config inspect"

    def execute(self, args: list[str], context: CommandContext) -> CommandResult:
        """执行配置自检命令。

        通过 load_project 加载项目，复用其内置的 inspect_config 检查逻辑，
        将收集到的 loading_errors 格式化为友好的 CLI 报告。

        Args:
            args: 命令参数列表（本命令不接收参数）
            context: 命令上下文

        Returns:
            自检结果，成功表示无问题，失败表示发现问题
        """
        if not context.is_project_open:
            return CommandResult.error("未打开项目，请先使用 'open <path>' 命令打开项目")

        project_path = context.project_path

        # 定位 manifest 文件
        import os

        manifest_path = os.path.join(project_path, "project.precis.yaml")
        if not os.path.isfile(manifest_path):
            # 兼容 .yml 后缀
            alt = os.path.join(project_path, "project.precis.yml")
            if os.path.isfile(alt):
                manifest_path = alt
            else:
                return CommandResult.error(f"未找到项目清单文件 project.precis.yaml（在 {project_path} 下）")

        # 复用 load_project：其内部已执行 inspect_config，结果在 loading_errors
        try:
            loaded = load_project(manifest_path)
        except Exception as e:
            return CommandResult.error(f"加载项目失败: {e}")

        errors: list[LoadingError] = loaded.loading_errors or []
        warnings: list[str] = loaded.warnings or []

        if not errors:
            extra = f"\n（另有 {len(warnings)} 条加载警告）" if warnings else ""
            return CommandResult.ok(f"{_CHECK_MARK} 配置自检通过，未发现问题{extra}")

        report = self._format_report(errors)
        # 有 blocker 时整体视为失败，否则视为成功附带警告
        has_blocker = any(e.severity == "blocker" for e in errors)
        summary = f"配置自检发现 {len(errors)} 个问题"
        if has_blocker:
            return CommandResult.error(f"{summary}:\n{report}")
        return CommandResult.ok(f"{summary}（均为非阻塞，建议处理）:\n{report}")

    def _format_report(self, errors: list[LoadingError]) -> str:
        """将 LoadingError 列表格式化为可读文本报告。

        按 severity 分组展示，每组下列出各问题的标题、文件路径与修复建议。

        Args:
            errors: 自检收集的错误列表

        Returns:
            格式化的多行文本报告
        """
        lines: list[str] = []

        # 按严重度分组：blocker → warning → info
        severity_order = ["blocker", "warning", "info"]
        grouped: dict[str, list[LoadingError]] = {s: [] for s in severity_order}
        for err in errors:
            grouped.setdefault(err.severity, []).append(err)

        for sev in severity_order:
            group = grouped.get(sev, [])
            if not group:
                continue
            icon, label = _SEVERITY_DISPLAY.get(sev, ("•", sev))
            lines.append(f"\n{icon} {label}（{len(group)}）")

            for err in group:
                title = err.title or err.error_type or "未知问题"
                lines.append(f"  {_CROSS_MARK} {title}")
                if err.file_path:
                    lines.append(f"     文件: {err.file_path}")
                if err.ref_id:
                    lines.append(f"     编号: {err.ref_id}")
                if err.description:
                    lines.append(f"     说明: {err.description}")
                if err.fix_hint:
                    lines.append(f"     建议: {err.fix_hint}")
                # 若有一键修复 API，提示用户（CLI 暂不自动修复，但告知可修复）
                if err.fix_api:
                    lines.append(f"     可修复: {err.fix_api.get('method', 'POST')} {err.fix_api.get('path', '')}")

        return "\n".join(lines)
