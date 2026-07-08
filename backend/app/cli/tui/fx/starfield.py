"""星空背景特效。"""

from __future__ import annotations

import random
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import NEON_PALETTE, Particle, ParticleEffect

if TYPE_CHECKING:
    pass


# 星空使用的字符
_STAR_CHARS = ["·", "•", "*", "+", "˖", "✦", "✧"]


class StarfieldEffect(ParticleEffect):
    """缓慢下落的星空/代码雨效果。

    粒子从顶部随机位置生成，以不同速度下落，模拟星空流动或轻柔的代码雨。
    """

    def __init__(self, density: float = 0.8, speed_range: tuple[float, float] = (0.3, 1.5)) -> None:
        """
        Args:
            density: 粒子密度系数，越高星空越密集。
            speed_range: 粒子下落速度范围（格/秒）。
        """
        super().__init__(name="starfield", max_particles=120)
        self.density = density
        self.speed_range = speed_range
        self._emit_accumulator = 0.0

    def _emit(self, dt: float, width: int, height: int) -> None:
        """根据密度持续发射新粒子。"""
        if width <= 0 or height <= 0:
            return
        self._emit_accumulator += dt
        # 每帧发射概率与密度相关
        target_count = int(width * height * 0.005 * self.density)
        while len(self.particles) < target_count and self._emit_accumulator > 0:
            self._emit_accumulator -= 0.05
            char = random.choice(_STAR_CHARS)  # noqa: S311
            speed = random.uniform(*self.speed_range)  # noqa: S311
            brightness = random.choice(["50", "70", "a0", "d0", "ff"])  # noqa: S311
            color = random.choice(NEON_PALETTE.colors)[:4] + brightness[:2]
            particle = Particle(
                x=random.uniform(0, width - 1),  # noqa: S311
                y=-1.0,
                vx=0.0,
                vy=speed,
                life=height / speed + 2.0,
                max_life=height / speed + 2.0,
                char=char,
                fg=color,
                style="dim",
            )
            self._spawn(particle)

    def _should_continue(self) -> bool:
        return True
