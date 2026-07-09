"""粒子系统与特效单元测试。"""

from __future__ import annotations

from app.cli.tui.fx.confetti import ConfettiEffect
from app.cli.tui.fx.particle import Particle
from app.cli.tui.fx.starfield import StarfieldEffect


def test_particle_update() -> None:
    """Particle update 应更新位置和生命。"""
    p = Particle(x=0, y=0, vx=1, vy=2, life=1.0, max_life=1.0)
    p.update(0.5)
    assert p.x == 0.5
    assert p.y == 1.0
    assert p.life == 0.5
    assert p.is_alive is True
    p.update(1.0)
    assert p.is_alive is False


def test_particle_alpha() -> None:
    """Particle alpha 应随生命减少。"""
    p = Particle(life=0.5, max_life=1.0)
    assert p.alpha == 0.5


def test_starfield_emits_particles() -> None:
    """StarfieldEffect 应持续发射粒子。"""
    fx = StarfieldEffect(density=1.0)
    fx.update(0.1, width=80, height=24)
    assert len(fx.particles) > 0


def test_starfield_has_depth_layers() -> None:
    """StarfieldEffect 生成的粒子应带有 depth 元数据。"""
    fx = StarfieldEffect(density=1.0)
    fx.update(0.1, width=80, height=24)
    assert len(fx._meta) > 0
    first_meta = next(iter(fx._meta.values()))
    assert 0.0 < first_meta.depth <= 1.0


def test_starfield_trails_for_fallers() -> None:
    """StarfieldEffect 的下落星应产生尾迹。"""
    fx = StarfieldEffect(density=2.0, faller_ratio=1.0, trail_length=3)
    fx.update(0.1, width=80, height=24)
    fx.update(0.2, width=80, height=24)
    assert any(len(t) > 0 for t in fx._trails.values())


def test_starfield_keeps_running() -> None:
    """StarfieldEffect 应始终处于活跃状态。"""
    fx = StarfieldEffect()
    fx.update(0.1, width=80, height=24)
    assert fx.is_alive is True


def test_theme_palette_follows_theme() -> None:
    """set_theme_palette 应切换调色板。"""
    from app.cli.tui.fx.particle import NEON_PALETTE, set_theme_palette

    original = list(NEON_PALETTE.colors)
    set_theme_palette("neon")
    assert NEON_PALETTE.colors == ["ff79c6", "8be9fd", "bd93f9", "50fa7b", "f1fa8c", "ffb86c"]
    set_theme_palette("nord")
    assert NEON_PALETTE.colors == ["88c0d0", "b48ead", "a3be8c", "ebcb8b", "bf616a", "81a1c1"]
    # 恢复
    NEON_PALETTE.colors = original


def test_aurora_emits_samples() -> None:
    """AuroraEffect 更新后应有采样点。"""
    from app.cli.tui.fx.aurora import AuroraEffect

    fx = AuroraEffect(band_count=2)
    fx.update(0.1, width=80, height=24)
    assert len(fx._samples) > 0


def test_aurora_speed_boost() -> None:
    """AuroraEffect 应支持动态速度倍率。"""
    from app.cli.tui.fx.aurora import AuroraEffect

    fx = AuroraEffect(band_count=2)
    fx.set_speed_boost(2.0)
    assert fx.speed_boost == 2.0
    fx.update(0.1, width=80, height=24)
    assert len(fx._samples) > 0
    """ConfettiEffect 应一次性发射所有粒子。"""
    fx = ConfettiEffect(particle_count=20, duration=1.0)
    fx.update(0.1, width=80, height=24)
    assert len(fx.particles) == 20
    assert fx._emitted is True


def test_confetti_ends_after_duration() -> None:
    """ConfettiEffect 在粒子全部死亡后应停止。"""
    fx = ConfettiEffect(particle_count=10, duration=0.1)
    fx.update(0.05, width=80, height=24)
    # 让所有粒子快速死亡
    for p in fx.particles:
        p.life = 0
    fx.update(0.1, width=80, height=24)
    assert fx.is_alive is False
