"""星空背景特效（闪烁 + 少量下落星，营造层次）。"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.cli.tui.fx.particle import NEON_PALETTE, BackgroundEffect, Particle

if TYPE_CHECKING:
    from app.cli.tui.fx.canvas import CanvasWidget


# 星点使用的字符（混用稀疏点与偶发的小星型，增加质感）。
_STAR_CHARS = ["•", "✦", "✧", "+", "·"]
# 闪烁星：更偏稀疏点状，避免密集成雪花。
_TWINKLE_CHARS = ["•", "·", "˖", "+"]
# 下落星：偏亮点，缓慢流动。
_FALL_CHARS = ["•", "˖", "+"]
# 尾迹字符
_TRAIL_CHARS = ["·", "˖", "'", "`"]


@dataclass
class _TwinkleMeta:
    """闪烁粒子的附加状态（与 Particle 并行存储，避免改动基类）。"""

    base_color: str  # 基础六位十六进制颜色（RRGGBB）
    freq: float  # 闪烁频率（弧度/秒）
    phase: float  # 闪烁相位（弧度）
    base_brightness: float  # 基础亮度（0..1），峰值
    depth: float  # 深度因子（0..1），越小越远越暗越慢


def _scale_brightness(hex_color: str, factor: float) -> str:
    """按 factor 缩放六位十六进制颜色的各通道亮度。

    Args:
        hex_color: 形如 "7aa2f7" 的六位十六进制颜色。
        factor: 0..1 的缩放系数（允许略大于 1 做轻微高光）。

    Returns:
        缩放后的六位十六进制颜色字符串。
    """
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    r = max(0, min(255, int(r * factor)))
    g = max(0, min(255, int(g * factor)))
    b = max(0, min(255, int(b * factor)))
    return f"{r:02x}{g:02x}{b:02x}"


class StarfieldEffect(BackgroundEffect):
    """闪烁星空背景 + 少量缓慢下落星 + 深度层。

    主要由大量**原位闪烁**的星点构成（亮度随时间 sin 脉动：明→暗→明），
    混入少量缓慢下落的星，营造层次感与呼吸感。

    P14 升级：
    - 新增 ``depth`` 参数控制远近分层：远处的星更暗、移动更慢、数量更多。
    - 下落星会留下短尾迹，增强流动感。
    - 调色板随主题联动（通过 particle.Neon_PALETTE）。

    设计要点：
    - 闪烁：每个粒子有独立的 freq/phase，用 ``sin(age*freq + phase)`` 计算瞬时亮度，
      覆盖到基础颜色的各通道。整体偏 dim，偶有较亮的峰值。
    - 下落：约 1/6 的粒子带向下速度，缓慢流动，作为点缀而非主体。
    - 密度：默认密度提高，让星空更饱满但不至于糊成一片。
    """

    def __init__(
        self,
        density: float = 2.2,
        speed_range: tuple[float, float] = (0.2, 0.9),
        faller_ratio: float = 0.14,
        max_particles: int = 400,
        depth_layers: int = 3,
        trail_length: int = 3,
    ) -> None:
        """
        Args:
            density: 粒子密度系数，越高星空越密集。
            speed_range: 下落星的速度范围（格/秒）。
            faller_ratio: 下落星占比（0..1），其余为静止闪烁星。
            max_particles: 粒子数量上限。
            depth_layers: 远近分层数（越大粒子深度越细分）。
            trail_length: 下落星尾迹长度。
        """
        super().__init__(name="starfield", max_particles=max_particles)
        self.density = density
        self.speed_range = speed_range
        self.faller_ratio = faller_ratio
        self.depth_layers = max(1, depth_layers)
        self.trail_length = max(0, trail_length)
        self._emit_accumulator = 0.0
        # id(particle) -> _TwinkleMeta，闪烁/下落参数并行表。
        self._meta: dict[int, _TwinkleMeta] = {}
        # 尾迹：id(particle) -> [(x, y, age_delta), ...]
        self._trails: dict[int, list[tuple[float, float, float]]] = {}

    def _emit(self, dt: float, width: int, height: int) -> None:
        """根据密度持续补充新粒子（闪烁星 + 下落星混合）。"""
        if width <= 0 or height <= 0:
            return
        self._emit_accumulator += dt
        # 提高密度公式：更大面积系数，让星空更饱满。
        target_count = int(width * height * 0.022 * self.density)
        target_count = min(target_count, self.max_particles)
        while len(self.particles) < target_count and self._emit_accumulator > 0:
            self._emit_accumulator -= 0.025
            self._spawn_one(width, height)

    def _spawn_one(self, width: int, height: int) -> None:
        """生成单个星点粒子并登记其闪烁元数据。"""
        is_faller = random.random() < self.faller_ratio  # noqa: S311
        base_color = random.choice(NEON_PALETTE.colors)  # noqa: S311
        # 深度：远处的星更多，但越暗越慢。
        depth = random.betavariate(2, 5) if not is_faller else random.betavariate(2, 3)
        depth = max(0.05, min(1.0, depth))

        # 大多数星偏暗（dim 基础亮度低），少数较亮。
        base_brightness = random.choice(  # noqa: S311
            [0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]
        )
        # 远处亮度进一步衰减（但保留最低可见亮度）
        base_brightness *= 0.6 + 0.4 * depth

        if is_faller:
            char = random.choice(_FALL_CHARS)  # noqa: S311
            speed = random.uniform(*self.speed_range) * (0.4 + 0.6 * depth)  # noqa: S311
            life = height / max(speed, 0.1) + 2.0
            vy = speed
            x = random.uniform(0, width - 1)  # noqa: S311
            y = random.uniform(-1.0, height * 0.3)  # noqa: S311
            # 下落星闪烁更慢、幅度小（保持流动感）。
            freq = random.uniform(1.0, 2.2)  # noqa: S311
        else:
            char = random.choice(_TWINKLE_CHARS)  # noqa: S311
            vy = 0.0
            # 闪烁星生命周期长，靠 age 驱动脉动；定期回收轮换位置。
            life = random.uniform(8.0, 20.0)  # noqa: S311
            x = random.uniform(0, width - 1)  # noqa: S311
            y = random.uniform(0, height - 1)  # noqa: S311
            # 静止闪烁星频率差异大，避免整齐划一的"呼吸"。
            freq = random.uniform(0.8, 3.5)  # noqa: S311

        particle = Particle(
            x=x,
            y=y,
            vx=0.0,
            vy=vy,
            life=life,
            max_life=life,
            char=char,
            fg=_scale_brightness(base_color, base_brightness),
            style="dim",
        )
        self._spawn(particle)
        # 仅当成功入队（未超上限）才登记元数据。
        if particle in self.particles:
            self._meta[id(particle)] = _TwinkleMeta(
                base_color=base_color,
                freq=freq,
                phase=random.uniform(0.0, 2 * math.pi),  # noqa: S311
                base_brightness=base_brightness,
                depth=depth,
            )
            if is_faller and self.trail_length > 0:
                self._trails[id(particle)] = []

    def update(self, dt: float, width: int, height: int) -> None:
        """更新粒子，记录尾迹，并清理已回收粒子的元数据。"""
        # 记录下落星尾迹
        for p in self.particles:
            meta = self._meta.get(id(p))
            if meta is not None and meta.depth > 0.1 and p.vy > 0:
                trail = self._trails.setdefault(id(p), [])
                trail.append((p.x, p.y, p.age))
                # 保留最近若干长度的尾迹点
                max_age = self.trail_length * 0.12 / max(p.vy, 0.1)
                trail[:] = [(x, y, a) for x, y, a in trail if p.age - a <= max_age]
                if len(trail) > self.trail_length * 2:
                    trail.pop(0)

        super().update(dt, width, height)
        # 回收失效粒子的元数据，避免字典无限增长。
        if len(self._meta) > len(self.particles) * 2 + 16:
            live_ids = {id(p) for p in self.particles}
            self._meta = {k: v for k, v in self._meta.items() if k in live_ids}
            self._trails = {k: v for k, v in self._trails.items() if k in live_ids}

    def render(self, canvas: CanvasWidget) -> None:
        """渲染粒子与尾迹：按闪烁相位重算瞬时亮度，覆盖 fg 后绘制。"""
        # 先渲染尾迹（在星点下方）
        for p in self.particles:
            trail = self._trails.get(id(p))
            if not trail:
                continue
            meta = self._meta.get(id(p))
            for idx, (tx, ty, ta) in enumerate(trail[:-1]):
                ix = int(tx)
                iy = int(ty)
                if 0 <= ix < canvas.canvas_width and 0 <= iy < canvas.canvas_height:
                    age_delta = p.age - ta
                    fade = max(0.0, 1.0 - age_delta / max(0.01, p.age - trail[0][2] if trail else 1.0))
                    if meta is not None:
                        factor = max(0.05, meta.base_brightness * 0.5 * fade)
                        fg = _scale_brightness(meta.base_color, factor)
                    else:
                        fg = p.fg
                    char = _TRAIL_CHARS[idx % len(_TRAIL_CHARS)]
                    canvas.blend(ix, iy, char, fg=fg, style="dim", alpha=fade * 0.6)

        for p in self.particles:
            meta = self._meta.get(id(p))
            if meta is not None:
                # sin 脉动：[-1,1] 映射到亮度 [0, base]。
                pulse = (math.sin(p.age * meta.freq + meta.phase) + 1.0) * 0.5
                factor = max(0.15, meta.base_brightness * (0.45 + 0.55 * pulse))
                fg = _scale_brightness(meta.base_color, factor)
            else:
                fg = p.fg
            ix = int(p.x)
            iy = int(p.y)
            if 0 <= ix < canvas.canvas_width and 0 <= iy < canvas.canvas_height:
                canvas.blend(ix, iy, p.char, fg=fg, bg=p.bg, style=p.style, alpha=p.alpha)
