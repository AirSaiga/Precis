"""Widget 样式动画工具（已废弃，保留向后兼容）。

.. deprecated:: 架构重构 #2
    本模块的自建 ``StyleTween`` 引擎已被 Textual 原生 ``widget.animate()``
    取代。原生方案用共享 60fps Animator + 自动去重，严格优于本模块。

    新代码请直接调用 ``widget.animate("opacity", value, duration, easing)``
    等原生 API，**不要**再 import 本模块的 ``animate_opacity`` /
    ``animate_tint`` / ``pulse_tint`` / ``pulse_border_color``。

    本模块暂时保留是为了：
      1. 避免破坏尚未发现的外部引用；
      2. 配套的单元测试（``tests/unit/tui/fx/test_animation.py``）仍验证
         引擎本身的正确性。

    grep 确认无调用方后可整体删除（含测试文件）。

    注意：Textual 原生 ``widget.animate("tint", ...)`` 不支持 ``$primary``
    等设计变量，且 tint 属性不可动画——迁移时这些场景改用 opacity 动画或
    静态高亮（见 ``focus_glow.py``）。

Textual 原生不支持 CSS transition/animation，本模块用 ``set_interval``
对 widget 的 ``styles.opacity`` / ``border`` 等属性做插值，实现轻量级动效。

所有动画对象都持有 ``Timer`` 引用，支持在 widget 销毁或动画被覆盖时主动清理，
避免定时器泄漏。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from textual.color import Color
from textual.timer import Timer
from textual.widget import Widget


# 简单缓动函数
def _ease_out_quad(t: float) -> float:
    """先快后慢的二次缓出。"""
    return 1 - (1 - t) * (1 - t)


def _ease_in_out_quad(t: float) -> float:
    """两端慢、中间快的二次缓入缓出。"""
    if t < 0.5:
        return 2 * t * t
    return 1 - ((-2 * t + 2) ** 2) / 2


def _ease_linear(t: float) -> float:
    """线性插值。"""
    return t


EASINGS: dict[str, Callable[[float], float]] = {
    "linear": _ease_linear,
    "ease-out": _ease_out_quad,
    "ease-in-out": _ease_in_out_quad,
}


def _clamp01(value: float) -> float:
    """将数值限制在 [0, 1]。"""
    return max(0.0, min(1.0, value))


def _lerp_color(start: str, end: str, t: float) -> str:
    """在两个十六进制颜色之间线性插值，返回带 # 的 hex。"""
    c1 = Color.parse(start)
    c2 = Color.parse(end)
    r = int(c1.r + (c2.r - c1.r) * t)
    g = int(c1.g + (c2.g - c1.g) * t)
    b = int(c1.b + (c2.b - c1.b) * t)
    return f"#{r:02x}{g:02x}{b:02x}"


class StyleTween:
    """对单个 widget 属性进行定时插值的动画对象。

    典型用法：

    ```python
    tween = StyleTween(widget, duration=0.2, on_update=_set_opacity)
    tween.start()
    ```

    ``on_update`` 接收当前插值进度 ``t``（已应用缓动函数），由调用方决定
    如何修改 widget 样式。
    """

    def __init__(
        self,
        widget: Widget,
        *,
        duration: float = 0.2,
        easing: str = "ease-out",
        fps: float = 20.0,
        on_update: Callable[[float], Any] | None = None,
        on_complete: Callable[[], Any] | None = None,
    ) -> None:
        """
        Args:
            widget: 动画目标 widget，用于挂载定时器。
            duration: 动画时长（秒）。
            easing: 缓动函数名（linear / ease-out / ease-in-out）。
            fps: 更新帧率。
            on_update: 每帧回调，参数为当前插值进度 [0,1]。
            on_complete: 动画完成回调。
        """
        self.widget = widget
        self.duration = max(0.0, duration)
        self.easing = EASINGS.get(easing, _ease_out_quad)
        self.fps = max(1.0, fps)
        self.on_update = on_update
        self.on_complete = on_complete
        self._timer: Timer | None = None
        self._elapsed: float = 0.0

    def start(self) -> None:
        """启动动画；duration 为 0 时同步完成。"""
        self.stop()
        if self.duration <= 0.0:
            self._call_update(1.0)
            self._call_complete()
            return
        self._elapsed = 0.0
        step = 1.0 / self.fps
        self._timer = self.widget.set_interval(step, self._tick)

    def stop(self) -> None:
        """停止动画并清理定时器。"""
        if self._timer is not None:
            self._timer.stop()
            self._timer = None

    def _tick(self) -> None:
        """定时步进。"""
        self._elapsed += 1.0 / self.fps
        t = _clamp01(self._elapsed / self.duration)
        self._call_update(self.easing(t))
        if t >= 1.0:
            self.stop()
            self._call_complete()

    def _call_update(self, t: float) -> None:
        """安全调用 on_update。"""
        if self.on_update is not None:
            try:
                self.on_update(t)
            except Exception:  # noqa: BLE001 - 动画回调失败不应阻断主流程
                pass

    def _call_complete(self) -> None:
        """安全调用 on_complete。"""
        if self.on_complete is not None:
            try:
                self.on_complete()
            except Exception:  # noqa: BLE001
                pass


def animate_opacity(
    widget: Widget,
    start: float,
    end: float,
    *,
    duration: float = 0.2,
    easing: str = "ease-out",
    on_complete: Callable[[], Any] | None = None,
) -> StyleTween:
    """让 widget 的 opacity 从 ``start`` 渐变到 ``end``。

    Args:
        widget: 目标 widget。
        start: 起始透明度 [0,1]。
        end: 结束透明度 [0,1]。
        duration: 动画时长。
        easing: 缓动函数。
        on_complete: 完成回调。

    Returns:
        动画对象，可调用 ``stop()`` 提前终止。
    """

    def _update(t: float) -> None:
        widget.styles.opacity = start + (end - start) * t

    tween = StyleTween(
        widget,
        duration=duration,
        easing=easing,
        on_update=_update,
        on_complete=on_complete,
    )
    tween.start()
    return tween


def animate_border_color(
    widget: Widget,
    start: str,
    end: str,
    *,
    border_style: str = "tall",
    duration: float = 0.4,
    easing: str = "ease-in-out",
    on_complete: Callable[[], Any] | None = None,
) -> StyleTween:
    """让 widget 的边框颜色从 ``start`` 渐变到 ``end``。

    Args:
        widget: 目标 widget。
        start: 起始颜色（任意 Textual 可解析颜色字符串）。
        end: 结束颜色。
        border_style: 边框样式（如 tall / thick / solid）。
        duration: 动画时长。
        easing: 缓动函数。
        on_complete: 完成回调。

    Returns:
        动画对象。
    """

    def _update(t: float) -> None:
        color = _lerp_color(start, end, t)
        widget.styles.border = (border_style, color)

    tween = StyleTween(
        widget,
        duration=duration,
        easing=easing,
        on_update=_update,
        on_complete=on_complete,
    )
    tween.start()
    return tween


def pulse_border_color(
    widget: Widget,
    color1: str,
    color2: str,
    *,
    border_style: str = "tall",
    duration: float = 1.2,
    fps: float = 10.0,
) -> StyleTween:
    """让 widget 边框颜色在 ``color1`` 与 ``color2`` 之间循环呼吸。

    返回的动画对象不会自动停止，需要调用方在失焦/销毁时调用 ``stop()``。

    Args:
        widget: 目标 widget。
        color1: 呼吸起点颜色。
        color2: 呼吸终点颜色。
        border_style: 边框样式。
        duration: 单次呼吸周期。
        fps: 更新帧率。

    Returns:
        持续运行的呼吸动画对象。
    """
    import math

    def _update(t: float) -> None:
        # t 是按 duration 线性递增后取模的相位 [0,1]
        phase = (math.sin(t * 2 * math.pi) + 1) / 2
        color = _lerp_color(color1, color2, phase)
        widget.styles.border = (border_style, color)

    class _PulseTween(StyleTween):
        def start(self) -> None:
            self.stop()
            self._elapsed = 0.0
            step = 1.0 / self.fps
            self._timer = self.widget.set_interval(step, self._tick)

        def _tick(self) -> None:
            self._elapsed += 1.0 / self.fps
            t = (self._elapsed % self.duration) / self.duration
            self._call_update(t)

    pulse = _PulseTween(
        widget,
        duration=duration,
        fps=fps,
        on_update=_update,
    )
    pulse.start()
    return pulse


def animate_tint(
    widget: Widget,
    start: str,
    end: str,
    *,
    duration: float = 0.3,
    easing: str = "ease-out",
    on_complete: Callable[[], Any] | None = None,
) -> StyleTween:
    """让 widget 的 tint 从 ``start`` 渐变到 ``end``。

    tint 适合制造不覆盖内容本身的光晕/高亮效果。

    Args:
        widget: 目标 widget。
        start: 起始 tint 颜色（如 ``$primary 0%``）。
        end: 结束 tint 颜色（如 ``$primary 25%``）。
        duration: 动画时长。
        easing: 缓动函数。
        on_complete: 完成回调。

    Returns:
        动画对象。
    """

    def _update(t: float) -> None:
        c1 = Color.parse(start)
        c2 = Color.parse(end)
        r = int(c1.r + (c2.r - c1.r) * t)
        g = int(c1.g + (c2.g - c1.g) * t)
        b = int(c1.b + (c2.b - c1.b) * t)
        a = c1.a + (c2.a - c1.a) * t
        widget.styles.tint = Color(r, g, b, a)

    tween = StyleTween(
        widget,
        duration=duration,
        easing=easing,
        on_update=_update,
        on_complete=on_complete,
    )
    tween.start()
    return tween


def pulse_tint(
    widget: Widget,
    color1: str,
    color2: str,
    *,
    duration: float = 1.2,
    fps: float = 10.0,
) -> StyleTween:
    """让 widget 的 tint 在 ``color1`` 与 ``color2`` 之间循环呼吸。

    返回的动画对象不会自动停止，需要调用方在失焦/销毁时调用 ``stop()``。

    Args:
        widget: 目标 widget。
        color1: 呼吸起点颜色。
        color2: 呼吸终点颜色。
        duration: 单次呼吸周期。
        fps: 更新帧率。

    Returns:
        持续运行的呼吸动画对象。
    """
    import math

    def _update(t: float) -> None:
        phase = (math.sin(t * 2 * math.pi) + 1) / 2
        c1 = Color.parse(color1)
        c2 = Color.parse(color2)
        r = int(c1.r + (c2.r - c1.r) * phase)
        g = int(c1.g + (c2.g - c1.g) * phase)
        b = int(c1.b + (c2.b - c1.b) * phase)
        a = c1.a + (c2.a - c1.a) * phase
        widget.styles.tint = Color(r, g, b, a)

    class _PulseTween(StyleTween):
        def start(self) -> None:
            self.stop()
            self._elapsed = 0.0
            step = 1.0 / self.fps
            self._timer = self.widget.set_interval(step, self._tick)

        def _tick(self) -> None:
            self._elapsed += 1.0 / self.fps
            t = (self._elapsed % self.duration) / self.duration
            self._call_update(t)

    pulse = _PulseTween(
        widget,
        duration=duration,
        fps=fps,
        on_update=_update,
    )
    pulse.start()
    return pulse
