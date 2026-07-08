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
    """配色板。"""

    colors: list[str] = field(default_factory=lambda: ["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c"])

    def random(self) -> str:
        """随机返回一种颜色。"""
        return random.choice(self.colors)  # noqa: S311 - 视觉效果不需要加密安全随机


# 每套主题对应的特效调色板（十六进制，无 # 前缀）。
# 与 styles/themes/*.tcss 的强调色对齐，让 confetti/starfield 颜色随主题变化。
_THEME_PALETTES: dict[str, list[str]] = {
    "tokyo-night": ["7aa2f7", "bb9af7", "9ece6a", "e0af68", "f7768e", "7dcfff"],
    "catppuccin": ["cba6f7", "f5c2e7", "a6e3a1", "f9e2af", "f38ba8", "89dceb"],
    "nord": ["88c0d0", "b48ead", "a3be8c", "ebcb8b", "bf616a", "81a1c1"],
    "neon": ["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c", "ffb86c"],
    "default": ["79a6ff", "56db84", "f0a44a", "e05050", "cc7cdf", "49c8ff"],
}

# 当前生效的调色板（特效发射粒子时读取此对象）。
# 切换主题时由 app.py 调用 set_theme_palette() 更新。
NEON_PALETTE = ColorPalette(list(_THEME_PALETTES["tokyo-night"]))


def set_theme_palette(theme: str) -> None:
    """切换特效调色板以匹配当前主题。

    Args:
        theme: 主题名（未注册时回落到 tokyo-night）。
    """
    NEON_PALETTE.colors = list(_THEME_PALETTES.get(theme, _THEME_PALETTES["tokyo-night"]))
