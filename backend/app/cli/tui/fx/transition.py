"""屏切换过渡遮罩。

``ScreenTransition`` 在 App 顶层挂载一个全屏 Static 遮罩，
通过定时器在 200ms 内完成「淡入 → 黑场 → 淡出」的屏切换过渡。

P12 升级：新增 ``direction`` 参数，让遮罩在淡入/淡出时伴随水平扫过动画：
- ``direction=0``：传统淡入淡出（无位移）。
- ``direction=1``：目标屏在「右侧」，遮罩从右向左扫过（前进感）。
- ``direction=-1``：目标屏在「左侧」，遮罩从左向右扫过（返回感）。

滑动只作用于遮罩本身，不依赖旧屏/新屏的 DOM 操作，因此与 Textual 的
Screen 栈切换天然兼容。

TODO（架构重构 #2 后续优化）：本模块仍用手搓 30fps 状态机，未改用 Textual
原生 ``widget.animate``。原因：三阶段（淡入→保持→淡出）+ 方向滑动的
on_complete 链实现较复杂，且本模块只持有单个 timer（由 ``_finish`` 在过渡
结束/异常时显式停止），不是泄漏源。改造收益小、风险大，故暂保留。
其他 fx 模块（animation.py / focus_glow.py）已完成原生 animate 迁移。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from textual.timer import Timer
from textual.widgets import Static

if TYPE_CHECKING:
    from textual.app import App


class ScreenTransition:
    """全屏淡入淡出 / 方向滑动过渡。

    Attributes:
        duration: 单次淡入或淡出的时长（秒），总过渡时间约 ``duration * 2 + hold``。
        hold: 完全黑场后保持的时间（秒），用于让新屏完成首次渲染。
        direction: 滑动方向。``0`` 无方向；``1`` 向右扫（前进）；``-1`` 向左扫（返回）。
    """

    def __init__(
        self,
        app: App,
        duration: float = 0.15,
        hold: float = 0.05,
        *,
        direction: int = 0,
    ) -> None:
        self.app = app
        self.duration = max(0.0, duration)
        self.hold = max(0.0, hold)
        self.direction = max(-1, min(1, direction))
        self._overlay = Static("", id="transition-overlay")
        self._timer: Timer | None = None
        self._elapsed: float = 0.0
        self._phase: int = 0  # 0 淡入, 1 保持, 2 淡出
        self._on_blackout: Callable[[], None] | None = None
        self._on_done: Callable[[], None] | None = None

    def run(self, on_blackout: Callable[[], None], on_done: Callable[[], None]) -> None:
        """启动过渡动画。

        Args:
            on_blackout: 遮罩完全不透明时调用（应在此处执行屏切换）。
            on_done: 过渡结束、遮罩移除后调用。
        """
        self._on_blackout = on_blackout
        self._on_done = on_done
        # 持续时间为 0 时直接同步完成，避免测试与快速路径中的除零问题
        if self.duration <= 0.0:
            on_blackout()
            on_done()
            return

        self._overlay.styles.opacity = 0.0
        if self.direction != 0:
            # 起始位置：与目标方向相反的一侧
            self._overlay.styles.offset = (self.direction * 100, 0)
        self._phase = 0
        self._elapsed = 0.0
        # 挂载到 App 顶层，作为最后子节点以覆盖所有现有内容
        try:
            self.app.mount(self._overlay)
        except Exception:  # noqa: BLE001 - mount 失败（如遮罩已存在）时回退直跳
            self._safe_call(self._on_blackout)
            self._safe_call(self._on_done)
            return
        # 约 30fps 的步进
        self._timer = self.app.set_interval(1 / 30, self._tick)

    def _safe_call(self, callback: Callable[[], None] | None) -> None:
        """安全调用回调，异常不外泄（保证过渡流程不被回调异常打断）。"""
        if callback is not None:
            try:
                callback()
            except Exception:  # noqa: BLE001
                pass

    def _tick(self) -> None:
        """定时步进：淡入/滑入 → 保持 → 淡出/滑出。"""
        try:
            self._do_tick()
        except Exception:  # noqa: BLE001 - 任何异常都强制结束过渡，释放锁
            self._finish()

    def _do_tick(self) -> None:
        """实际的步进逻辑（_tick 的异常安全包装内层）。"""
        step = 1 / 30
        self._elapsed += step
        if self._phase == 0:
            progress = min(1.0, self._elapsed / self.duration)
            self._overlay.styles.opacity = progress
            if self.direction != 0:
                # 从起始侧（±100%）滑到中央（0%）
                offset_x = int(self.direction * 100 * (1 - progress))
                self._overlay.styles.offset = (offset_x, 0)
            if progress >= 1.0:
                self._phase = 1
                self._elapsed = 0.0
                self._safe_call(self._on_blackout)
        elif self._phase == 1:
            if self._elapsed >= self.hold:
                self._phase = 2
                self._elapsed = 0.0
        else:
            progress = min(1.0, self._elapsed / self.duration)
            self._overlay.styles.opacity = 1.0 - progress
            if self.direction != 0:
                # 从中央（0%）滑向目标侧（∓100%）
                offset_x = int(-self.direction * 100 * progress)
                self._overlay.styles.offset = (offset_x, 0)
            if progress >= 1.0:
                self._finish()

    def _finish(self) -> None:
        """清理定时器与遮罩。"""
        if self._timer is not None:
            self._timer.stop()
            self._timer = None
        try:
            self._overlay.remove()
        except Exception:  # noqa: BLE001 - 遮罩可能已被提前移除
            pass
        self._safe_call(self._on_done)
