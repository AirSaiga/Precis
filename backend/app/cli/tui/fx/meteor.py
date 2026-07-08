"""流星特效：右上→左下划过，带渐变拖尾。

偶发性点缀动效，让画面有呼吸感。流星一次性划过整屏后消失，
由 ``EffectEngine`` 周期性（约每 8-15 秒随机）自动触发。
"""

from __future__ import annotations

import math
import random
from collections import deque
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import NEON_PALETTE, Effect

if TYPE_CHECKING:
    from app.cli.tui.fx.canvas import CanvasWidget


# 拖尾字符：头部偏实心，尾部偏点状。
_TRAIL_CHARS = ["*", "•", "·", "˖", "⋅"]


class MeteorEffect(Effect):
    """单颗流星：从右上区划向左下区，带渐变拖尾。

    实现说明：
    - 头部沿单位方向向量匀速移动；拖尾用 ``deque`` 保留最近若干个位置点。
    - 渲染时头部最亮、尾部渐暗（alpha 从 1.0 线性衰减到 0），形成光带。
    - 头部离开屏幕边界即结束（``_running = False``），一次性特效。
    - 流星颜色取自当前主题调色板，偏亮（青/白冷调），与暗淡星光形成反差。
    """

    def __init__(
        self,
        width: int,
        height: int,
        speed: float = 18.0,
        tail_length: int = 5,
        color: str | None = None,
    ) -> None:
        """
        Args:
            width: 画布宽度（用于确定起点与出屏判定）。
            height: 画布高度。
            speed: 头部移动速度（格/秒）。
            tail_length: 拖尾采样点数（不含头部，建议 3-6）。
            color: 流星颜色（六位十六进制），None 则从调色板取偏冷亮色。
        """
        super().__init__(name="meteor")
        self.speed = speed
        self.tail_length = max(2, tail_length)
        # 方向：左下（dx<0, dy>0），单位化。
        # 轻微随机化角度，避免每次轨迹完全一致。
        angle = math.radians(random.uniform(18.0, 34.0))  # noqa: S311
        self._dir_x = -math.cos(angle)
        self._dir_y = math.sin(angle)
        # 起点：屏幕右上区域（含少量越界起步，让流星"飞入"）。
        start_x = random.uniform(width * 0.6, width + 3)  # noqa: S311
        start_y = random.uniform(-2.0, height * 0.35)  # noqa: S311
        self._x = start_x
        self._y = start_y
        self._start_x = start_x
        self._start_y = start_y
        # 拖尾位置点（头部当前点 + 历史），每个元素为 (x, y)。
        self._trail: deque[tuple[float, float]] = deque(maxlen=self.tail_length + 1)
        self._trail.append((start_x, start_y))
        # 颜色：偏冷亮色优先，增强"流星"质感。
        if color is None:
            cool = ["7dcfff", "7aa2f7", "9ece6a", "89dceb", "8be9fd"]
            color = (
                random.choice(cool)
                if not NEON_PALETTE.colors
                else random.choice(  # noqa: S311
                    [c for c in NEON_PALETTE.colors if c in cool] or NEON_PALETTE.colors[:3]
                )
            )
        self._color = color
        self._width = width
        self._height = height

    def update(self, dt: float, width: int, height: int) -> None:
        """移动头部并记录拖尾；头部出屏后结束特效。"""
        self._width = width
        self._height = height
        if width <= 0 or height <= 0:
            return
        self._x += self._dir_x * self.speed * dt
        self._y += self._dir_y * self.speed * dt
        self._trail.append((self._x, self._y))
        # 头部完全离开屏幕（左侧或下侧）即结束。
        if self._x < -self.tail_length or self._y > height + self.tail_length:
            self._running = False

    def render(self, canvas: CanvasWidget) -> None:
        """渲染拖尾：头部最亮，尾部渐暗。"""
        points = list(self._trail)
        n = len(points)
        if n == 0:
            return
        # 从尾（最旧、最暗）到头（最新、最亮）依次绘制。
        for idx, (px, py) in enumerate(points):
            ix = int(px)
            iy = int(py)
            if not (0 <= ix < canvas.canvas_width and 0 <= iy < canvas.canvas_height):
                continue
            # 头部 idx == n-1（alpha=1.0），尾部 idx==0（alpha 趋近 0）。
            t = idx / max(n - 1, 1)
            alpha = 0.15 + 0.85 * t
            # 头部用更亮的字符与样式，尾部用点状 dim。
            if idx == n - 1:
                char = _TRAIL_CHARS[0]
                style = "bold"
            else:
                char = _TRAIL_CHARS[min(idx, len(_TRAIL_CHARS) - 1)]
                style = None
            canvas.blend(ix, iy, char, fg=self._color, style=style, alpha=alpha)

    def stop(self) -> None:
        """停止特效。"""
        super().stop()


__all__ = ["MeteorEffect"]
