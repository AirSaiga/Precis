"""全局焦点高亮服务。

``FocusGlow`` 监听当前 Screen 内焦点变化，为获得焦点的可交互控件添加静态
主题色边框高亮；焦点移走时自动清理。它只改边框样式，不涉及内容渲染。

历史：原实现用自建的 ``pulse_tint``（永不停止的 10fps 定时器做 tint 呼吸），
架构重构 #2 改为静态高亮——零 timer、零泄漏风险，最 Textual、最稳定。
Textual 原生 ``widget.animate("tint", ...)`` 不支持 ``$primary`` 设计变量且
tint 属性不可动画，故脉冲方案不可行；静态高亮是无障碍友好（不闪烁）的最简解。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from textual.widget import Widget


class FocusGlow:
    """焦点高亮管理器。

    由 ``BaseScreen`` 持有并随屏生命周期启停。通过监听
    ``on_descendant_focus`` / ``on_descendant_blur`` 事件实现，
    避免轮询 ``app.focused``。

    获得焦点时给 widget 设置主题色高亮边框（静态，不闪烁），失焦时恢复
    transparent 边框。无定时器，无泄漏风险。
    """

    # 高亮边框（主题色）。失焦时恢复为 transparent。
    GLOW_BORDER: tuple[str, str] = ("round", "$primary")

    def __init__(self, screen: Any) -> None:
        """
        Args:
            screen: 所属 Screen（通常是 BaseScreen 子类）。
        """
        self.screen = screen
        self._current: Widget | None = None
        self._disabled = False

    @property
    def enabled(self) -> bool:
        """高亮开关状态。"""
        return not self._disabled

    def toggle(self) -> bool:
        """切换开关，返回新的启用状态。"""
        self._disabled = not self._disabled
        if self._disabled:
            self._clear()
        elif self._current is not None:
            self._apply(self._current)
        return not self._disabled

    def set_enabled(self, enabled: bool) -> None:
        """设置开关状态。"""
        if enabled == self.enabled:
            return
        self.toggle()

    def on_focus(self, widget: Widget) -> None:
        """descendant 获得焦点时调用。"""
        if self._disabled:
            self._current = widget
            return
        if widget is self._current:
            return
        self._clear()
        self._current = widget
        self._apply(widget)

    def on_blur(self, widget: Widget) -> None:
        """descendant 失去焦点时调用。"""
        if widget is not self._current:
            return
        self._clear()
        self._current = None

    def _apply(self, widget: Widget) -> None:
        """对目标 widget 应用静态高亮边框。"""
        try:
            widget.styles.border = self.GLOW_BORDER
        except Exception:  # noqa: BLE001 - widget 可能已失效
            pass

    def _clear(self) -> None:
        """恢复当前 widget 的边框（不重置当前 widget 引用）。"""
        if self._current is not None:
            try:
                self._current.styles.border = ("none", "transparent")
            except Exception:  # noqa: BLE001
                pass

    def stop(self) -> None:
        """完全停止并清理（Screen 卸载时调用）。"""
        self._clear()
        self._current = None
