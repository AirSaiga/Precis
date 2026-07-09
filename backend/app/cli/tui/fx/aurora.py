"""极光背景特效。

用若干条水平正弦光带模拟 Aurora 流动效果，颜色取自当前主题调色板，
以低亮度、低 alpha 渲染到画布背景层，营造柔和的氛围光幕。
"""

from __future__ import annotations

import math
import random
from collections import deque
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import NEON_PALETTE, BackgroundEffect

if TYPE_CHECKING:
    from app.cli.tui.fx.canvas import CanvasWidget


# 极光采样字符：从稀疏点到短横，模拟光幕质感
_AURORA_CHARS = ["~", "-", "=", ":", "·", "˖", "•"]


class AuroraBand:
    """单条极光光带的状态。"""

    def __init__(
        self,
        width: int,
        height: int,
        color: str,
        *,
        layer: int = 0,
        total_layers: int = 1,
    ) -> None:
        self.width = width
        self.height = height
        self.color = color
        self.layer = layer
        self.total_layers = max(1, total_layers)
        # 垂直基准位置（屏幕高度比例 0..1）
        self.base_y_ratio = random.uniform(0.2, 0.8)  # noqa: S311
        # 垂直漂移速度（比例/秒）
        self.drift_speed = random.uniform(-0.04, 0.04)  # noqa: S311
        # 正弦波动幅度（字符行数）
        self.amplitude = random.uniform(1.5, 3.5)  # noqa: S311
        # 水平波动频率（整个屏幕宽度内的周期数）
        self.freq = random.uniform(0.8, 2.2)  # noqa: S311
        # 相位漂移速度
        self.phase_speed = random.uniform(0.3, 0.9)  # noqa: S311
        self.phase = random.uniform(0.0, 2 * math.pi)  # noqa: S311
        self.age = 0.0
        # 多层：不同层的垂直偏移与速度有差异
        self._layer_offset = (layer / self.total_layers - 0.5) * 0.3

    def sample_y(self, x: float) -> float:
        """给定水平位置 x，返回该点光带的垂直位置。"""
        base_y = self.height * (self.base_y_ratio + self._layer_offset)
        # 叠加两个不同频率的正弦波，让光带边缘更自然
        wave1 = math.sin((x / max(self.width, 1)) * self.freq * 2 * math.pi + self.phase)
        wave2 = math.sin((x / max(self.width, 1)) * self.freq * 3.7 * math.pi + self.phase * 1.3) * 0.35
        return base_y + (wave1 + wave2) * self.amplitude

    def update(self, dt: float) -> None:
        """更新光带相位与垂直基准位置。"""
        self.age += dt
        self.phase += self.phase_speed * dt
        self.base_y_ratio += self.drift_speed * dt
        # 边界反弹，避免飘出屏幕
        if self.base_y_ratio < 0.15:
            self.base_y_ratio = 0.15
            self.drift_speed = abs(self.drift_speed)
        elif self.base_y_ratio > 0.85:
            self.base_y_ratio = 0.85
            self.drift_speed = -abs(self.drift_speed)

    def get_brightness(self, y: float) -> float:
        """根据像素离基准线距离计算亮度因子。"""
        base_y = self.height * (self.base_y_ratio + self._layer_offset)
        dist = abs(y - base_y)
        return max(0.25, 1.0 - dist / (self.amplitude + 1.0))


class AuroraEffect(BackgroundEffect):
    """极光背景特效。

    由多条水平正弦光带组成，光带缓慢垂直漂移并水平波动，颜色柔和低亮。
    作为常驻背景特效，通过 ``EffectEngine.set_background`` 管理。
    """

    def __init__(
        self,
        band_count: int = 4,
        speed_range: tuple[float, float] = (0.25, 0.9),
        amplitude_range: tuple[float, float] = (1.5, 4.0),
        chars: list[str] | None = None,
        max_particles: int = 240,
        speed_boost: float = 1.0,
    ) -> None:
        """
        Args:
            band_count: 光带数量。
            speed_range: 水平相位漂移速度范围（弧度/秒）。
            amplitude_range: 光带正弦波动幅度范围（字符行）。
            chars: 采样字符集合；None 使用默认。
            max_particles: 每帧采样点数上限。
            speed_boost: 全局速度倍率（可随主题/焦点动态调整）。
        """
        super().__init__(name="aurora", max_particles=max_particles)
        self.band_count = max(1, band_count)
        self.speed_range = speed_range
        self.amplitude_range = amplitude_range
        self.chars = chars or list(_AURORA_CHARS)
        self.speed_boost = max(0.1, speed_boost)
        self._bands: list[AuroraBand] = []
        # 采样点历史（用于拖尾淡出）
        self._samples: deque[tuple[int, int, str, str, float]] = deque(maxlen=max_particles)
        # 历史帧用于多层拖尾
        self._history: deque[list[tuple[int, int, str, str, float]]] = deque(maxlen=4)
        self._emit_accumulator = 0.0

    def set_speed_boost(self, boost: float) -> None:
        """动态调整全局流动速度。"""
        self.speed_boost = max(0.1, boost)

    def _ensure_bands(self, width: int, height: int) -> None:
        """首次更新时根据画布尺寸初始化光带。"""
        if self._bands:
            return
        palette = NEON_PALETTE.colors or ["7aa2f7", "9ece6a", "bb9af7"]
        # 从调色板取色，允许重复以让多条光带同色系
        colors = [random.choice(palette) for _ in range(self.band_count)]  # noqa: S311
        for idx, color in enumerate(colors):
            band = AuroraBand(width, height, color, layer=idx, total_layers=self.band_count)
            band.amplitude = random.uniform(*self.amplitude_range)  # noqa: S311
            band.phase_speed = random.uniform(*self.speed_range)  # noqa: S311
            self._bands.append(band)

    def _emit(self, dt: float, width: int, height: int) -> None:
        """每帧沿各光带采样新的渲染点。"""
        if width <= 0 or height <= 0:
            return
        self._ensure_bands(width, height)
        boosted_dt = dt * self.speed_boost
        for band in self._bands:
            band.update(boosted_dt)

        self._emit_accumulator += dt
        # 控制采样密度：约每 0.04 秒全宽度采样一次
        if self._emit_accumulator < 0.04:
            return
        self._emit_accumulator = 0.0

        # 把上一帧采样压入历史，制造拖尾
        if self._samples:
            self._history.append(list(self._samples))

        # 清空旧采样，重新生成一帧
        self._samples.clear()
        step = max(1, width // 90)  # 根据宽度调整采样密度
        for band in self._bands:
            for x in range(0, width, step):
                y = band.sample_y(float(x))
                # 垂直方向也做少量随机抖动，让光带边缘更柔和
                y += random.uniform(-0.4, 0.4)  # noqa: S311
                iy = int(round(y))
                if 0 <= iy < height:
                    char = random.choice(self.chars)  # noqa: S311
                    brightness = band.get_brightness(y)
                    alpha = 0.25 + 0.55 * brightness
                    self._samples.append((x, iy, char, band.color, alpha))

    def render(self, canvas: CanvasWidget) -> None:
        """渲染采样点到画布（低 alpha 混合），并叠加历史帧拖尾。"""
        # 先渲染历史帧作为拖尾
        for age, frame in enumerate(reversed(self._history)):
            fade = 0.75 - age * 0.15
            if fade <= 0:
                continue
            for x, y, char, color, alpha in frame:
                if 0 <= x < canvas.canvas_width and 0 <= y < canvas.canvas_height:
                    canvas.blend(x, y, char, fg=color, style="dim", alpha=alpha * fade)
        # 当前帧最亮
        for x, y, char, color, alpha in self._samples:
            if 0 <= x < canvas.canvas_width and 0 <= y < canvas.canvas_height:
                # 低亮度颜色：通过 alpha 控制覆盖强度
                canvas.blend(x, y, char, fg=color, style="none", alpha=alpha)


__all__ = ["AuroraEffect"]
