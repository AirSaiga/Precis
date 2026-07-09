"""极光背景特效单元测试。"""

from __future__ import annotations

from app.cli.tui.fx.aurora import AuroraBand, AuroraEffect
from app.cli.tui.fx.canvas import CanvasWidget
from app.cli.tui.fx.particle import BackgroundEffect


def test_aurora_band_sample_y_uses_sine() -> None:
    """AuroraBand 的采样位置应随 x 变化且处于合理范围。"""
    band = AuroraBand(width=80, height=24, color="7aa2f7")
    y0 = band.sample_y(0.0)
    y40 = band.sample_y(40.0)
    y80 = band.sample_y(80.0)
    # 正弦波动应使不同 x 位置的 y 可能不同
    assert 0 <= y0 < 24
    assert 0 <= y80 < 24
    assert isinstance(y40, float)


def test_aurora_effect_is_background_effect() -> None:
    """AuroraEffect 应是常驻背景特效。"""
    fx = AuroraEffect()
    assert isinstance(fx, BackgroundEffect)


def test_aurora_effect_emits_samples() -> None:
    """AuroraEffect 更新后应在采样历史中产生点。"""
    fx = AuroraEffect(band_count=2, max_particles=200)
    fx.update(0.1, width=80, height=24)
    assert len(fx._samples) > 0


def test_aurora_effect_keeps_running() -> None:
    """AuroraEffect 在多次更新后仍应保持活跃。"""
    fx = AuroraEffect()
    for _ in range(50):
        fx.update(0.1, width=80, height=24)
    assert fx.is_alive is True


def test_aurora_effect_renders_to_canvas() -> None:
    """AuroraEffect 应能把采样点绘制到 CanvasWidget。"""
    canvas = CanvasWidget()
    canvas._buffer.resize(80, 24)
    fx = AuroraEffect(band_count=2)
    fx.update(0.2, width=80, height=24)
    fx.render(canvas)
    drawn = sum(1 for row in canvas._buffer.cells for cell in row if cell.char != " ")
    assert drawn > 0
