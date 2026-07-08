"""庆祝彩带特效。"""

from __future__ import annotations

import random
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import NEON_PALETTE, Particle, ParticleEffect

if TYPE_CHECKING:
    pass


# 庆祝字符
_CONFETTI_CHARS = ["✦", "✧", "✴", "✸", "✺", "◆", "◇", "•"]


class ConfettiEffect(ParticleEffect):
    """短时间的庆祝彩带效果。

    从屏幕中心或指定位置向四周喷射彩色字符粒子，随后受重力下落消失。
    适合校验通过、配置生成完成等成功场景。
    """

    def __init__(
        self,
        origin_x: float | None = None,
        origin_y: float | None = None,
        particle_count: int = 40,
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

    def _emit(self, dt: float, width: int, height: int) -> None:
        """在生命周期开始时一次性发射所有粒子。"""
        if self._emitted or width <= 0 or height <= 0:
            return
        self._emitted = True
        ox = self.origin_x if self.origin_x is not None else width / 2
        oy = self.origin_y if self.origin_y is not None else height / 2
        for _ in range(self.particle_count):
            speed = random.uniform(3.0, 10.0)  # noqa: S311
            vx = speed * random.uniform(-1.0, 1.0)  # noqa: S311
            vy = speed * random.uniform(-1.5, 0.5)  # noqa: S311
            particle = Particle(
                x=ox,
                y=oy,
                vx=vx,
                vy=vy,
                life=random.uniform(0.8, self.duration),  # noqa: S311
                max_life=random.uniform(0.8, self.duration),  # noqa: S311
                char=random.choice(_CONFETTI_CHARS),  # noqa: S311
                fg=NEON_PALETTE.random(),
                style="bold",
            )
            # 给粒子一个向下的重力感
            particle.vy += 2.0
            self._spawn(particle)

    def update(self, dt: float, width: int, height: int) -> None:
        """更新粒子并增加重力。"""
        for p in self.particles:
            p.vy += 8.0 * dt  # 重力
            p.update(dt)
        self.particles = [p for p in self.particles if p.is_alive]
        self._emit(dt, width, height)
        self._elapsed += dt
        if self._elapsed > self.duration and not self.particles:
            self._running = False

    def _should_continue(self) -> bool:
        return self._elapsed < self.duration
