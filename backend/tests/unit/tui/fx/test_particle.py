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


def test_starfield_keeps_running() -> None:
    """StarfieldEffect 应始终处于活跃状态。"""
    fx = StarfieldEffect()
    fx.update(0.1, width=80, height=24)
    assert fx.is_alive is True


def test_confetti_emits_once() -> None:
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
