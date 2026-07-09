"""@fileoverview TUI 底部状态栏组件（P6 / v2）

功能概述:
- 单行底部状态栏，展示「当前项目名 + 当前屏 + 当前 Provider + 常用快捷键」。
- 原 Footer（快捷键栏）已合并到本组件，释放一行纵向空间。
- 项目名取自 ``app.project_path``（经 ``project_ops.resolve_project_label`` 解析显示名）；
  Provider 取自 ``get_cli_config().get_active_provider()``。
- 通过 ``refresh_state()`` 在项目切换、屏切换或定时刷新时被 App 调用，更新文案。

架构设计:
- 继承 ``Static``（无交互），仅做只读展示。
- 业务读取全部委托 ``shared_services.project_ops`` 与 ``shell.config_storage``，
  本组件不含任何复制规则。
- 读取 Provider 时做防御性兜底：配置加载失败、无 Provider 等情况下显示占位文案，
  绝不抛异常到上层（状态栏崩溃会挡住整个 UI）。
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

from textual.widgets import Static

from app.cli.shared_services import project_ops

if TYPE_CHECKING:
    from app.cli.tui.protocols import ProjectState

logger = logging.getLogger(__name__)

# 状态栏右侧展示的常用全局快捷键提示
_SHORTCUT_HINT = "[dim]Ctrl+P[/dim] 面板 · [dim]F2[/dim] 主题 · [dim]F3[/dim] 背景 · [dim]Ctrl+Q[/dim] 退出"

# 分段之间的低对比度分隔符
_SEGMENT_SEPARATOR = "[dim]│[/dim]"


class StatusBar(Static):
    """底部状态栏。

    展示当前打开的项目名（绿点=已打开 / 黄圈=未打开）、当前屏、活动 Provider
    以及常用全局快捷键。调用 ``refresh_state(app)`` 刷新；App 在 ``push_screen`` /
    项目变化后应调用。
    """

    DEFAULT_CSS = """
    StatusBar {
        dock: bottom;
        height: 1;
    }
    """

    def render(self) -> str:
        """渲染状态栏文本。

        首次渲染前若未被 refresh 过，展示占位文案。``refresh_state`` 会改写
        ``Static`` 的内容（通过 ``update``），无需重写 render。
        """
        return (
            f"[yellow]○[/yellow] 未打开项目  {_SEGMENT_SEPARATOR}  "
            f"-  {_SEGMENT_SEPARATOR}  "
            f"Provider: -  {_SEGMENT_SEPARATOR}  "
            f"{_SHORTCUT_HINT}"
        )

    def refresh_state(self, project_state: ProjectState | Any) -> None:
        """根据当前项目状态刷新状态栏文案。

        Args:
            project_state: 实现 ProjectState 协议的对象（通常为 App）。
                用 getattr 防御性读取，兼容未实现协议的对象。
        """
        project_part = self._render_project_part(project_state)
        screen_part = self._render_screen_part(project_state)
        provider_part = self._render_provider_part()
        self.update(
            f"{project_part}  {_SEGMENT_SEPARATOR}  "
            f"{screen_part}  {_SEGMENT_SEPARATOR}  "
            f"{provider_part}  {_SEGMENT_SEPARATOR}  "
            f"{_SHORTCUT_HINT}"
        )

    def _render_project_part(self, project_state: ProjectState | Any) -> str:
        """渲染项目部分文案。

        已打开显示「绿点 + 项目名」；未打开显示「黄圈 + 未打开项目」。
        读取/解析失败时降级为目录名或原始路径。
        """
        path = getattr(project_state, "project_path", None)
        if not path:
            return "[yellow]○[/yellow] 未打开项目"
        try:
            label = project_ops.resolve_project_label(path)
        except Exception:  # noqa: BLE001 - 状态栏兜底，不抛
            label = os.path.basename(path) or path
        return f"[green]●[/green] [bold]{label}[/bold]"

    def _render_screen_part(self, project_state: ProjectState | Any) -> str:
        """渲染当前屏名，增强位置感知。"""
        screen = getattr(project_state, "screen", None)
        if screen is None:
            return "[dim]-[/dim]"
        name = type(screen).__name__.replace("Screen", "")
        return f"[dim]{name}[/dim]" if name else "[dim]-[/dim]"

    def _render_provider_part(self) -> str:
        """渲染 Provider 部分文案。

        读取当前活动 Provider 的 name + model；读取失败或无 Provider 时显示占位。
        """
        try:
            # 延迟导入：避免在模块加载时触发配置文件读取（可能失败）
            from app.cli.shell.config_storage import get_cli_config

            provider = get_cli_config().get_active_provider()
        except Exception:  # noqa: BLE001 - 状态栏兜底，不抛
            return "[dim]Provider:[/dim] [warning]配置加载失败[/warning]"
        if provider is None:
            return "[dim]Provider:[/dim] [warning]未配置[/warning]"
        return f"[dim]Provider:[/dim] [bold]{provider.name}[/bold]/{provider.model}"


__all__ = ["StatusBar"]
