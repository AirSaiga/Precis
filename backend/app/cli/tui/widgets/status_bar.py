# backend/app/cli/tui/widgets/status_bar.py
"""@fileoverview TUI 底部状态栏组件（P6）

功能概述:
- 单行底部状态栏，展示「当前项目名 + 当前 Provider」两项关键全局状态。
- 项目名取自 ``app.project_path``（经 ``project_ops.resolve_project_label`` 解析显示名）；
  Provider 取自 ``get_cli_config().get_active_provider()``。
- 通过 ``refresh_state()`` 在项目切换、屏切换或定时刷新时被 App 调用，更新文案。

架构设计:
- 继承 ``Static``（无交互），仅做只读展示。
- 业务读取全部委托 ``shared_services.project_ops`` 与 ``shell.config_storage``，
  本组件不含任何复制规则。
- 读取 Provider 时做防御性兜底：配置加载失败、无 Provider 等情况下显示占位文案，
  绝不抛异常到上层（状态栏崩溃会挡住整个 UI）。

复用（只读 import）:
- ``project_ops.resolve_project_label`` — 解析项目显示名
- ``get_cli_config`` — 读取当前活动 Provider
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


class StatusBar(Static):
    """底部状态栏。

    展示当前打开的项目名（绿点=已打开 / 黄圈=未打开）与当前活动 Provider。
    调用 ``refresh_state(app)`` 刷新；App 在 ``push_screen`` / 项目切换后应调用。
    """

    DEFAULT_CSS = """
    StatusBar {
        dock: bottom;
        height: 1;
        background: $panel;
        color: $text;
        padding: 0 1;
        text-style: none;
    }
    """

    def render(self) -> str:
        """渲染状态栏文本。

        首次渲染前若未被 refresh 过，展示占位文案。``refresh_state`` 会改写
        ``Static`` 的内容（通过 ``update``），无需重写 render。
        """
        return "○ 未打开项目  |  -  |  Provider: -"

    def refresh_state(self, project_state: ProjectState | Any) -> None:
        """根据当前项目状态刷新状态栏文案。

        Args:
            project_state: 实现 ProjectState 协议的对象（通常为 App）。
                用 getattr 防御性读取，兼容未实现协议的对象。
        """
        project_part = self._render_project_part(project_state)
        screen_part = self._render_screen_part(project_state)
        provider_part = self._render_provider_part()
        self.update(f"{project_part}  |  {screen_part}  |  {provider_part}")

    def _render_project_part(self, project_state: ProjectState | Any) -> str:
        """渲染项目部分文案。

        已打开显示「绿点 + 项目名」；未打开显示「黄圈 + 未打开项目」。
        读取/解析失败时降级为目录名或原始路径。
        """
        path = getattr(project_state, "project_path", None)
        if not path:
            return "○ 未打开项目"
        try:
            label = project_ops.resolve_project_label(path)
        except Exception:  # noqa: BLE001 - 状态栏兜底，不抛
            label = os.path.basename(path) or path
        return f"● {label}"

    def _render_screen_part(self, project_state: ProjectState | Any) -> str:
        """渲染当前屏名，增强位置感知。"""
        screen = getattr(project_state, "screen", None)
        if screen is None:
            return "-"
        name = type(screen).__name__.replace("Screen", "")
        return name if name else "-"

    def _render_provider_part(self) -> str:
        """渲染 Provider 部分文案。

        读取当前活动 Provider 的 name + model；读取失败或无 Provider 时显示占位。
        """
        try:
            # 延迟导入：避免在模块加载时触发配置文件读取（可能失败）
            from app.cli.shell.config_storage import get_cli_config

            provider = get_cli_config().get_active_provider()
        except Exception:  # noqa: BLE001 - 状态栏兜底，不抛
            return "Provider: [配置加载失败]"
        if provider is None:
            return "Provider: 未配置"
        return f"Provider: {provider.name}/{provider.model}"


__all__ = ["StatusBar"]
