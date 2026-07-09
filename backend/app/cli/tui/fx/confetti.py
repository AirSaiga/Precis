"""庆祝彩带特效（增强版）。

从屏幕中心或指定位置向四周喷射彩色字符粒子，带短拖尾与字符旋转，
随后受重力下落消失。适合校验通过、配置生成完成等成功场景。
"""

from __future__ import annotations

import math
import random
from collections import deque
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import NEON_PALETTE, Particle, ParticleEffect

if TYPE_CHECKING:
    pass


# 庆祝字符：包含不同填充感与方向感，用于模拟旋转
_CONFETTI_CHARS = ["◆", "■", "▲", "●", "✦", "✴", "✸", "✺", "•"]

# 额外亮色池（30% 概率使用，增加视觉丰富度）
_EXTRA_COLORS = ["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c", "ffb86c", "ff5555", "ffffff", "f8f8f2"]


def _rotated_char(vx: float, _vy: float) -> str:
    """根据水平速度方向挑选一个偏向旋转感的字符。"""
    if abs(vx) < 1.0:
        return random.choice(["◐", "◑", "◒", "◓"])  # noqa: S311
    if vx > 0:
        return random.choice(["✦", "✴", "◆", "◓"])  # noqa: S311
    return random.choice(["✧", "✸", "◇", "◐"])  # noqa: S311


class ConfettiEffect(ParticleEffect):
    """短时间的庆祝彩带效果。

    从屏幕中心或指定位置向四周喷射彩色字符粒子，带短拖尾，随后受重力下落消失。
    """

    def __init__(
        self,
        origin_x: float | None = None,
        origin_y: float | None = None,
        particle_count: int = 60,
        duration: float = 1.5,
    ) -> None:
        """
        Args:
            origin_x: 发射源 X，None 表示屏幕中心。
            origin_y: 发射源 Y，None 表示屏幕中心。
            particle_count: 粒子总数。
            duration: 特效持续时间（秒）。
        """
        super().__init__(name="confetti", max_particles=particle_count)
        self.origin_x = origin_x
        self.origin_y = origin_y
        self.particle_count = particle_count
        self.duration = duration
        self._elapsed = 0.0
        self._emitted = False
        # 每个粒子的拖尾历史：id(particle) -> deque[(x, y), ...]
        self._trails: dict[int, deque[tuple[float, float]]] = {}

    def _emit(self, dt: float, width: int, height: int) -> None:
        """在生命周期开始时一次性发射所有粒子。"""
        if self._emitted or width <= 0 or height <= 0:
            return
        self._emitted = True
        ox = self.origin_x if self.origin_x is not None else width / 2
        oy = self.origin_y if self.origin_y is not None else height / 2
        palette = NEON_PALETTE.colors or ["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c"]
        for _ in range(self.particle_count):
            speed = random.uniform(4.0, 11.0)  # noqa: S311
            # 向上扇形喷射，角度范围约 -160° ~ -20°（以向下为 0°）
            angle = random.uniform(-2.8, -0.35)  # noqa: S311
            vx = speed * math.cos(angle)
            vy = speed * math.sin(angle)
            life = random.uniform(1.0, self.duration + 0.5)  # noqa: S311
            # 70% 概率使用主题色，30% 使用随机亮色增加丰富度
            if random.random() < 0.7:  # noqa: S311
                fg = random.choice(palette)  # noqa: S311
            else:
                fg = random.choice(_EXTRA_COLORS)  # noqa: S311
            particle = Particle(
                x=ox,
                y=oy,
                vx=vx,
                vy=vy,
                life=life,
                max_life=life,
                char=random.choice(_CONFETTI_CHARS),  # noqa: S311
                fg=fg,
                style="bold",
            )
            self._spawn(particle)
            if particle in self.particles:
                self._trails[id(particle)] = deque(maxlen=3)

    def update(self, dt: float, width: int, height: int) -> None:
        """更新粒子位置、重力、拖尾，并回收死亡粒子。"""
        for p in self.particles:
            p.vy += 9.0 * dt  # 重力
            p.update(dt)
            # 根据速度方向切换字符，制造旋转感
            p.char = _rotated_char(p.vx, p.vy)
            # 更新拖尾
            trail = self._trails.get(id(p))
            if trail is not None:
                trail.append((p.x, p.y))

        # 回收死亡粒子的拖尾
        live_ids = {id(p) for p in self.particles}
        self._trails = {k: v for k, v in self._trails.items() if k in live_ids}
        self.particles = [p for p in self.particles if p.is_alive]

        self._emit(dt, width, height)
        self._elapsed += dt
        if self._elapsed > self.duration and not self.particles:
            self._running = False

    def render(self, canvas) -> None:
        """渲染粒子及其拖尾。"""
        # 先渲染拖尾（旧位置更暗）
        for pid, trail in self._trails.items():
            points = list(trail)
            for idx, (px, py) in enumerate(points[:-1]):  # 不渲染头部（头部是粒子本身）
                ix = int(px)
                iy = int(py)
                if not (0 <= ix < canvas.canvas_width and 0 <= iy < canvas.canvas_height):
                    continue
                # 越旧的点越暗
                t = (idx + 1) / max(len(points) - 1, 1)
                alpha = 0.2 + 0.5 * t
                canvas.blend(ix, iy, "·", fg=self._particle_color(pid), style="dim", alpha=alpha)

        # 再渲染头部
        for p in self.particles:
            ix = int(p.x)
            iy = int(p.y)
            if 0 <= ix < canvas.canvas_width and 0 <= iy < canvas.canvas_height:
                canvas.blend(ix, iy, p.char, fg=p.fg, style=p.style, alpha=p.alpha)

    def _particle_color(self, pid: int) -> str | None:
        """根据粒子 id 反查颜色（用于拖尾）。"""
        for p in self.particles:
            if id(p) == pid:
                return p.fg
        return None

    def _should_continue(self) -> bool:
        return self._elapsed < self.duration


__all__ = ["ConfettiEffect"]
