"""粒子系统与特效基类。"""

from __future__ import annotations

import random
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.cli.tui.fx.canvas import CanvasWidget


@dataclass
class Particle:
    """单个粒子。"""

    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    life: float = 1.0  # 剩余生命（秒）
    max_life: float = 1.0
    char: str = "*"
    fg: str | None = None  # 十六进制颜色
    bg: str | None = None
    style: str | None = None
    age: float = 0.0

    @property
    def is_alive(self) -> bool:
        """粒子是否仍然存活。"""
        return self.life > 0

    @property
    def alpha(self) -> float:
        """基于生命的透明度。"""
        if self.max_life <= 0:
            return 1.0
        return max(0.0, min(1.0, self.life / self.max_life))

    def update(self, dt: float) -> None:
        """更新粒子状态。"""
        self.age += dt
        self.life -= dt
        self.x += self.vx * dt
        self.y += self.vy * dt


class Effect(ABC):
    """特效基类。"""

    def __init__(self, name: str = "") -> None:
        self.name = name or self.__class__.__name__
        self._running = True

    @abstractmethod
    def update(self, dt: float, width: int, height: int) -> None:
        """每帧更新特效状态。"""

    @abstractmethod
    def render(self, canvas: CanvasWidget) -> None:
        """将特效渲染到画布。"""

    @property
    def is_alive(self) -> bool:
        """特效是否仍然活跃。"""
        return self._running

    def stop(self) -> None:
        """停止特效。"""
        self._running = False


class ParticleEffect(Effect, ABC):
    """基于粒子的特效基类。"""

    def __init__(self, name: str = "", max_particles: int = 100) -> None:
        super().__init__(name)
        self.max_particles = max_particles
        self.particles: list[Particle] = []
        self._last_emit = 0.0

    def update(self, dt: float, width: int, height: int) -> None:
        """更新所有粒子并回收死亡粒子。"""
        for p in self.particles:
            p.update(dt)
        self.particles = [p for p in self.particles if p.is_alive]
        self._emit(dt, width, height)
        if not self.particles and not self._should_continue():
            self._running = False

    def render(self, canvas: CanvasWidget) -> None:
        """渲染粒子到画布。"""
        for p in self.particles:
            ix = int(p.x)
            iy = int(p.y)
            if 0 <= ix < canvas.canvas_width and 0 <= iy < canvas.canvas_height:
                canvas.blend(ix, iy, p.char, fg=p.fg, bg=p.bg, style=p.style, alpha=p.alpha)

    @abstractmethod
    def _emit(self, dt: float, width: int, height: int) -> None:
        """子类实现粒子发射逻辑。"""

    def _should_continue(self) -> bool:
        """子类可覆盖：没有粒子时是否继续产生。"""
        return True

    def _spawn(self, particle: Particle) -> None:
        """添加一个粒子，受最大数量限制。"""
        if len(self.particles) < self.max_particles:
            self.particles.append(particle)


@dataclass
class ColorPalette:
    """霓虹配色板。"""

    colors: list[str] = field(default_factory=lambda: ["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c"])

    def random(self) -> str:
        """随机返回一种颜色。"""
        return random.choice(self.colors)  # noqa: S311 - 视觉效果不需要加密安全随机


# 默认霓虹调色板
NEON_PALETTE = ColorPalette(["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c", "ffb86c"])
