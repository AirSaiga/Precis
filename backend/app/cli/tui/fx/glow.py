"""光晕/呼吸灯特效。

通过动态改变目标 Widget 的 CSS 类或边框颜色，制造呼吸光晕效果。
注意：Textual 的 CSS 动态更新有一定开销，这里用轻量级方式实现。
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import Effect

if TYPE_CHECKING:
    from textual.widgets import Static


class GlowEffect(Effect):
    """让目标 Widget 的边框颜色周期性呼吸变化。

    不渲染到 Canvas，而是通过设置目标 widget 的 `border` 样式属性实现。
    """

    def __init__(self, target: Static, colors: list[str] | None = None, speed: float = 1.0) -> None:
        """
        Args:
            target: 目标 Widget（需要支持 CSS 样式更新）。
            colors: 循环颜色列表（十六进制）。
            speed: 呼吸速度（周期/秒）。
        """
        super().__init__(name="glow")
        self.target = target
        self.colors = colors or ["ff79c6", "8be9fd", "bd93f9"]
        self.speed = speed
        self._elapsed = 0.0

    def update(self, dt: float, width: int, height: int) -> None:
        """更新光晕颜色。"""
        self._elapsed += dt
        if not self.colors:
            return
        t = (math.sin(self._elapsed * self.speed * 2 * math.pi) + 1) / 2
        idx = int(t * (len(self.colors) - 1))
        color = self.colors[idx]
        try:
            self.target.styles.border = ("thick", f"#{color}")
        except Exception:  # noqa: BLE001 - 样式更新失败不阻断
            pass

    def render(self, canvas) -> None:  # noqa: ARG002 - Glow 不渲染到 Canvas
        """Glow 不渲染到 Canvas。"""
        return None

    def stop(self) -> None:
        """停止时恢复默认边框。"""
        super().stop()
        try:
            self.target.styles.border = ("round", "$background")
        except Exception:  # noqa: BLE001
            pass
