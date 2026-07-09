# backend/app/cli/tui/widgets/command_palette.py
"""@fileoverview TUI 命令面板（P6）

功能概述:
- Ctrl+P 唤出的模态屏，列出所有已注册的功能屏（遍历 ``SCREEN_REGISTRY``）。
- 用 ``OptionList`` 展示「屏名 + 简短中文描述」，方向键导航、回车跳转、ESC 关闭。
- 选中后 ``dismiss(screen_name)``，由 App 回调执行 ``push_screen`` 跳转。

架构设计:
- 继承 ``ModalScreen[str | None]``：dismiss 返回选中的屏名（或 None 表示取消）。
- 屏名→中文描述的映射维护在本模块的 ``_SCREEN_DESCRIPTIONS``，不污染
  ``protocols.SCREEN_REGISTRY``（后者只存 name→类，描述属 UI 关注点）。
- 不直接 ``app.push_screen``，而是把选择结果回传给 App，保持「面板只负责选择」的
  单一职责，便于测试与复用。

复用（只读 import）:
- ``SCREEN_REGISTRY`` — app.cli.tui.protocols（遍历获取全部已注册屏）
"""

from __future__ import annotations

from textual import on
from textual.app import ComposeResult
from textual.containers import Vertical
from textual.geometry import Offset
from textual.screen import ModalScreen
from textual.widgets import Input, Label, OptionList
from textual.widgets.option_list import Option

from app.cli.tui.protocols import SCREEN_REGISTRY

# 屏注册名 → 简短中文描述（用于命令面板展示）。
# 新增屏时在此补一行即可；未列出的屏会降级显示注册名本身。
_SCREEN_DESCRIPTIONS: dict[str, str] = {
    "dashboard": "首页 · 项目概览与快捷入口",
    "validation": "校验 · 打开项目并执行数据校验",
    "provider": "Provider · 管理 AI 服务商与连接测试",
    "config": "配置 · 查看/编辑/检查项目配置",
    "chat": "对话 · 与 AI 对话分析项目数据",
    "generate": "生成 · 从数据文件生成 Precis 配置",
    "migrate": "迁移 · 从旧脚本迁移生成配置",
}


class CommandPalette(ModalScreen[str | None]):
    """命令面板模态屏。

    居中弹出，列出 SCREEN_REGISTRY 中全部已注册屏。选中后 dismiss(屏名)，
    ESC / 取消 dismiss(None)。App 接到屏名后执行 push_screen 跳转。
    """

    DEFAULT_CSS = """
    CommandPalette {
        align: center middle;
    }
    #palette-box {
        width: 70;
        max-height: 80%;
        border: thick $primary;
        background: $surface;
        padding: 1 2;
        opacity: 0;
        offset: 0 -2;
        transition: opacity 120ms, offset 120ms;
    }
    #palette-box.open {
        opacity: 1;
        offset: 0 0;
    }
    #palette-box.closing {
        opacity: 0;
        offset: 0 -1;
    }
    #palette-title {
        text-style: bold;
        color: $accent;
        margin-bottom: 1;
    }
    #palette-search {
        margin-bottom: 1;
    }
    #palette-list {
        height: auto;
        max-height: 70%;
    }
    #palette-hint {
        color: $text-muted;
        margin-top: 1;
    }
    """

    BINDINGS = [("escape", "cancel", "关闭")]

    def __init__(self) -> None:
        super().__init__()
        # 保存完整屏列表，用于搜索过滤时恢复。
        self._all_options: list[tuple[str, str]] = []
        self._dismissing = False
        self._pending_result: str | None = None

    def compose(self) -> ComposeResult:
        """组装命令面板：标题 + 搜索框 + 选项列表 + 操作提示。"""
        yield Vertical(
            Label("命令面板 · 选择要打开的屏", id="palette-title"),
            Input(placeholder="输入屏名或描述过滤…", id="palette-search"),
            OptionList(id="palette-list"),
            Label("↑↓ 导航 · Enter 打开 · Esc 取消", id="palette-hint"),
            id="palette-box",
        )

    def on_mount(self) -> None:
        """挂载时从 SCREEN_REGISTRY 填充选项列表并记录完整列表，然后播放入场动效。"""
        option_list = self.query_one("#palette-list", OptionList)
        self._all_options = [(name, _SCREEN_DESCRIPTIONS.get(name, name)) for name in sorted(SCREEN_REGISTRY)]
        for name, desc in self._all_options:
            option_list.add_option(Option(desc, id=name))
        # 默认聚焦搜索框
        self.query_one("#palette-search", Input).focus()
        self._play_enter_animation()

    def _play_enter_animation(self) -> None:
        """从上方淡入并回正的入场动效。"""
        box = self.query_one("#palette-box", Vertical)
        box.styles.opacity = 0.0
        box.styles.offset = Offset(0, -2)

        def _open() -> None:
            box.add_class("open")

        self.set_timer(0.02, _open)

    def dismiss(self, result: str | None = None) -> None:
        """覆盖 dismiss：先播放退场动效，再真正关闭模态屏。"""
        if self._dismissing:
            super().dismiss(result)
            return
        self._dismissing = True
        self._pending_result = result
        self._play_exit_animation()
        self.set_timer(0.15, self._do_real_dismiss)

    def _do_real_dismiss(self) -> None:
        """退场动效完成后真正 dismiss。"""
        super().dismiss(self._pending_result)

    def _play_exit_animation(self) -> None:
        """向上淡出退场。"""
        box = self.query_one("#palette-box", Vertical)
        box.add_class("closing")

    @on(Input.Changed, "#palette-search")
    def _on_search_changed(self, event: Input.Changed) -> None:
        """根据搜索输入过滤选项列表。"""
        query = event.value.strip().lower()
        option_list = self.query_one("#palette-list", OptionList)
        option_list.clear_options()
        for name, desc in self._all_options:
            if not query or query in name.lower() or query in desc.lower():
                option_list.add_option(Option(desc, id=name))
        # 更新提示
        count = option_list.option_count
        hint = self.query_one("#palette-hint", Label)
        if query:
            hint.update(f"匹配 {count} 项 · ↑↓ 导航 · Enter 打开 · Esc 取消")
        else:
            hint.update("↑↓ 导航 · Enter 打开 · Esc 取消")

    @on(OptionList.OptionSelected)
    def _on_option_selected(self, event: OptionList.OptionSelected) -> None:
        """选中某项时 dismiss(屏名)。"""
        event.stop()
        screen_name = event.option.id
        self.dismiss(screen_name)

    def action_cancel(self) -> None:
        """ESC 关闭面板，dismiss(None) 表示取消。"""
        self.dismiss(None)


__all__ = ["CommandPalette"]
