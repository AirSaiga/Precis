# backend/app/cli/tui/widgets/history_list.py
"""
@fileoverview TUI 历史项目列表组件（P1）

功能概述:
- 展示 ``project_ops.load_history()`` 返回的历史项目，用 ``resolve_project_label``
  解析显示名。
- 选中（回车/点击）某项后通过 ``project_ops.open_project`` 触发打开，并发出
  ``HistoryOpened`` 消息携带 ``OpenResult``，由父屏据此更新全局项目状态并刷新 UI。

架构设计:
- 继承 ``ListView``，复用 Textual 的键盘导航（上下选择、回车确认）。
- 业务逻辑全部委托 ``app.cli.shared_services.project_ops``，本组件不含任何复制规则。
- 不直接读写全局 ProjectState（避免与 App 耦合），改用消息把 OpenResult 上抛。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from textual.message import Message
from textual.widgets import Label, ListItem, ListView

from app.cli.shared_services import project_ops


@dataclass
class HistoryEntry:
    """历史列表中单个条目的数据。

    Attributes:
        path: 项目绝对路径（来自历史记录的 path 字段）。
        label: 显示名（resolve_project_label 解析，优先 project.name，降级目录名）。
    """

    path: str
    label: str


class HistoryList(ListView):
    """历史项目列表组件。

    挂载时自动从 ``project_ops.load_history()`` 加载条目并渲染。
    空历史时显示占位提示。选中某项后调用 ``project_ops.open_project`` 打开，
    并发出 ``HistoryOpened`` 消息供父屏更新状态。
    """

    DEFAULT_CSS = """
    HistoryList {
        height: 1fr;
        border: round $primary;
        padding: 0 1;
    }
    HistoryList > ListItem {
        padding: 0 1;
    }
    """

    def __init__(self, id: str | None = None, classes: str | None = None) -> None:
        super().__init__(id=id, classes=classes)
        # 当前条目列表，与 ListItem 的渲染顺序一一对应，供选中时反查路径
        self._entries: list[HistoryEntry] = []

    def compose(self) -> None:
        """渲染历史条目。空历史时显示占位 ListItem。"""
        self._entries = self._load_entries()
        if not self._entries:
            yield ListItem(Label("（暂无历史项目，请先用 open 打开一个项目）"), id="empty")
            return
        for entry in self._entries:
            # 标签后附 dim 的路径，便于同名项目区分
            yield ListItem(Label(f"{entry.label}  [dim]{entry.path}[/dim]"))

    def reload(self) -> None:
        """重新加载历史并刷新列表。

        供父屏在打开/关闭项目后调用，使列表与磁盘历史保持同步。
        """
        self._entries = self._load_entries()
        self.clear()
        if not self._entries:
            self.append(ListItem(Label("（暂无历史项目，请先用 open 打开一个项目）"), id="empty"))
            return
        for entry in self._entries:
            self.append(ListItem(Label(f"{entry.label}  [dim]{entry.path}[/dim]")))

    def _load_entries(self) -> list[HistoryEntry]:
        """从 project_ops 加载历史并解析显示名。

        Returns:
            HistoryEntry 列表；历史为空或加载失败时返回空列表。
        """
        history: list[dict[str, Any]] = project_ops.load_history()
        entries: list[HistoryEntry] = []
        for item in history:
            path = item.get("path")
            if not path:
                continue
            label = project_ops.resolve_project_label(path)
            entries.append(HistoryEntry(path=path, label=label))
        return entries

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        """选中某项时触发打开并发出 HistoryOpened 消息。

        Args:
            event: ListView 的 Selected 消息，含被选中的 item 与 index。
        """
        event.stop()
        index = event.index
        # 越界或占位项（空历史）不处理
        if index < 0 or index >= len(self._entries):
            return
        entry = self._entries[index]
        result = project_ops.open_project(entry.path)
        self.post_message(self.HistoryOpened(result=result, list_view=self))

    class HistoryOpened(Message):
        """历史项目被打开后发出，供父屏更新全局状态并刷新 UI。

        Attributes:
            result: project_ops.open_project 返回的 OpenResult。
            list_view: 发出该消息的 HistoryList 实例。
        """

        def __init__(self, result: Any, list_view: HistoryList) -> None:
            super().__init__()
            self.result: Any = result
            """打开结果（OpenResult，含 success/project_path/config/manifest_path/message）。"""
            self.list_view: HistoryList = list_view
            """发出消息的 HistoryList 实例。"""


__all__ = ["HistoryEntry", "HistoryList"]
