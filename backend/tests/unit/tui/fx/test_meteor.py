"""流星特效与增强星空单元测试。"""

from __future__ import annotations

from app.cli.tui.fx.canvas import CanvasWidget
from app.cli.tui.fx.meteor import MeteorEffect
from app.cli.tui.fx.starfield import StarfieldEffect, _scale_brightness


def test_scale_brightness_clamps() -> None:
    """亮度缩放应在 0..255 间钳制并保持六位格式。"""
    assert _scale_brightness("ffffff", 0.0) == "000000"
    assert _scale_brightness("7aa2f7", 1.0) == "7aa2f7"
    # factor>1 也应被钳制到 255
    out = _scale_brightness("808080", 2.0)
    assert out == "ffffff"


def test_starfield_registers_twinkle_meta() -> None:
    """StarfieldEffect 发射粒子后应登记闪烁元数据。"""
    fx = StarfieldEffect(density=2.0)
    fx.update(0.2, width=80, height=24)
    assert len(fx.particles) > 0
    # 每个粒子都应有对应闪烁元数据
    for p in fx.particles:
        assert id(p) in fx._meta


def test_starfield_keeps_running_after_long_update() -> None:
    """StarfieldEffect 持续更新后仍应保持活跃，且会回收失效元数据。"""
    fx = StarfieldEffect(density=1.0)
    for _ in range(50):
        fx.update(0.2, width=80, height=24)
    assert fx.is_alive is True
    # 元数据表不应膨胀到远超存活粒子数
    assert len(fx._meta) <= len(fx.particles) * 2 + 16


def test_starfield_density_higher() -> None:
    """默认密度提高后，相同区域粒子应明显多于旧实现。

    发射受累加器节流，需多帧累积才能填满目标数量。
    """
    fx = StarfieldEffect()
    # 多帧更新让发射累加器填满目标粒子数
    for _ in range(20):
        fx.update(0.1, width=80, height=24)
    # 旧公式稳态约为 width*height*0.005*0.8 ≈ 7；新公式应明显更多
    assert len(fx.particles) > 20


def test_starfield_renders_to_canvas() -> None:
    """StarfieldEffect 应能把粒子绘制到 CanvasWidget。"""
    canvas = CanvasWidget()
    canvas._buffer.resize(40, 12)
    fx = StarfieldEffect(density=2.0)
    fx.update(0.2, width=40, height=12)
    fx.render(canvas)
    # 至少有一个非空字符落入画布
    drawn = sum(1 for row in canvas._buffer.cells for cell in row if cell.char != " ")
    assert drawn > 0


def test_meteor_runs_then_exits() -> None:
    """流星应向左下移动并最终在出屏后结束。"""
    fx = MeteorEffect(width=80, height=24, speed=40.0)
    assert fx.is_alive is True
    # 头部应持续向左下（dx<0, dy>0）
    prev_x = fx._x
    prev_y = fx._y
    fx.update(0.1, width=80, height=24)
    assert fx._x < prev_x
    assert fx._y > prev_y
    # 推进足够长时间，应出屏结束
    for _ in range(200):
        fx.update(0.1, width=80, height=24)
        if not fx.is_alive:
            break
    assert fx.is_alive is False


def test_meteor_render_draws_trail() -> None:
    """流星渲染应在画布上留下拖尾字符。"""
    canvas = CanvasWidget()
    canvas._buffer.resize(80, 24)
    fx = MeteorEffect(width=80, height=24, speed=20.0)
    # 移动几帧积累拖尾
    fx.update(0.2, width=80, height=24)
    fx.render(canvas)
    drawn = sum(1 for row in canvas._buffer.cells for cell in row if cell.char != " ")
    assert drawn > 0


def test_meteor_tail_grows_within_limit() -> None:
    """拖尾长度应受 tail_length+1 上限约束。"""
    fx = MeteorEffect(width=80, height=24, speed=30.0, tail_length=4)
    for _ in range(20):
        fx.update(0.05, width=80, height=24)
    assert len(fx._trail) <= 5  # tail_length+1
