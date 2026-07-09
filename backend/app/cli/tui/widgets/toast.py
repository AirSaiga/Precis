"""增强版 Toast 通知系统。

Textual 原生的 ``Toast``/``ToastRack`` 没有入场/退场动效；本模块通过子类化
添加滑入、淡出和错误抖动效果，同时保持与 ``App.notify`` 完全兼容。
"""

from __future__ import annotations

from typing import Any

from textual._on import on
from textual.app import RenderResult
from textual.events import Click, Mount
from textual.geometry import Offset
from textual.widgets._toast import Notification, Toast, ToastHolder, ToastRack


class AnimatedToast(Toast):
    """带滑入/淡出/抖动动效的 Toast 子类。

    入场时从右侧滑入并淡入；错误级别时附带轻微水平抖动；
    退场时先淡出再移除自身，避免生硬消失。
    """

    inherit_css = False

    DEFAULT_CSS = """
    AnimatedToast {
        width: 60;
        max-width: 50%;
        height: auto;
        margin-top: 1;
        visibility: visible;
        padding: 1 1;
        background: $panel-lighten-1;
        color: $foreground;
        offset: 0 0;
        opacity: 0;
    }
    AnimatedToast.-information { border-left: outer $success; }
    AnimatedToast.-information .toast--title { color: $text-success; }
    AnimatedToast.-warning { border-left: outer $warning; }
    AnimatedToast.-warning .toast--title { color: $text-warning; }
    AnimatedToast.-error { border-left: outer $error; }
    AnimatedToast.-error .toast--title { color: $text-error; }
    """

    def __init__(self, notification: Notification) -> None:
        super().__init__(notification)
        self._dismissing = False

    def render(self) -> RenderResult:
        """保持与父类相同的渲染逻辑。"""
        return super().render()

    def _on_mount(self, _: Mount) -> None:
        """挂载后启动入场动效，并设置过期定时器。"""
        self._play_enter_animation()
        self.set_timer(self._timeout, self._expire)

    def _play_enter_animation(self) -> None:
        """从右侧滑入并淡入。"""
        # Textual 的 styles.animate 无法对 offset 的 ScalarOffset 起点做插值，
        # 因此这里用短时钟循环手动更新 offset，并同步淡入 opacity。
        # （原 animate_tint 高亮因 Textual 原生不支持 tint 动画且 $primary
        # 设计变量不可被 Color.parse 解析，故省略——滑入 + 淡入已足够吸引注意。）
        start_x = self.app.size.width
        self.styles.offset = Offset(start_x, 0)
        self.styles.opacity = 0.0

        def _slide_in() -> None:
            steps = 10
            duration = 0.25
            interval = duration / steps
            from textual._animator import EASING

            ease = EASING["out_cubic"]

            def _step(idx: int) -> None:
                if idx > steps:
                    self.styles.offset = Offset(0, 0)
                    self.styles.opacity = 1.0
                    if self._notification.severity == "error":
                        self._play_shake()
                    return
                progress = idx / steps
                eased = ease(progress)
                x = int(start_x * (1 - eased))
                self.styles.offset = Offset(x, 0)
                self.styles.opacity = eased
                self.set_timer(interval, lambda i=idx + 1: _step(i))

            _step(1)

        self.set_timer(0.02, _slide_in)

    def _play_shake(self) -> None:
        """错误提示的水平抖动。"""
        sequence = [Offset(2, 0), Offset(-2, 0), Offset(1, 0), Offset(-1, 0), Offset(0, 0)]

        def _step(idx: int) -> None:
            if idx >= len(sequence):
                return
            self.styles.offset = sequence[idx]
            self.set_timer(0.04, lambda i=idx + 1: _step(i))

        _step(0)

    @on(Click)
    def _expire(self) -> None:
        """点击或超时时先淡出再移除。"""
        if self._dismissing:
            return
        self._dismissing = True

        def _remove() -> None:
            self.app._unnotify(self._notification, refresh=False)
            holder = self.parent if isinstance(self.parent, ToastHolder) else self
            holder.remove()

        try:
            # 原生 widget.styles.animate：opacity 1.0 → 0.0，完成后移除 toast。
            # 由共享 Animator 管理，比自建 StyleTween 更轻量且自动去重。
            self.styles.animate("opacity", 0.0, duration=0.18, easing="in_cubic", on_complete=_remove)
        except Exception:  # noqa: BLE001
            _remove()


class AnimatedToastRack(ToastRack):
    """增强版 ToastRack：使用 AnimatedToast 并暴露 speed_boost 给 aurora。"""

    inherit_css = False

    DEFAULT_CSS = """
    AnimatedToastRack {
        display: none;
        layer: _toastrack;
        width: 1fr;
        height: auto;
        dock: bottom;
        align: right bottom;
        visibility: hidden;
        layout: vertical;
        overflow-y: scroll;
        margin-bottom: 1;
    }
    """

    def show(self, notifications: Any) -> None:
        """覆盖父类 show，使用 AnimatedToast 并触发入场。"""
        self.display = bool(notifications)

        # 移除已过期的 toast
        for toast in self.query(AnimatedToast):
            if toast._notification not in notifications:
                if not getattr(toast, "_dismissing", False):
                    toast._expire()

        new_toasts: list[Notification] = []
        for notification in notifications:
            try:
                _ = self.get_child_by_id(self._toast_id(notification))
            except Exception:  # noqa: BLE001
                if not notification.has_expired:
                    new_toasts.append(notification)

        if new_toasts:
            holders = [ToastHolder(AnimatedToast(toast), id=self._toast_id(toast)) for toast in new_toasts]
            self.mount_all(holders)
            self.call_later(self.scroll_end, animate=False, force=True)
