"""CanvasWidget 单元测试。"""

from __future__ import annotations

from app.cli.tui.fx.canvas import CanvasWidget, Cell, RenderBuffer


def test_cell_to_style() -> None:
    """Cell 应正确转换为 Rich 样式字符串。"""
    cell = Cell("*", fg="ff79c6", bg="282a36", style="bold")
    assert cell.to_style() == "#ff79c6 on #282a36 bold"


def test_cell_reset() -> None:
    """Cell reset 应清空所有属性。"""
    cell = Cell("*", fg="ff79c6", style="bold")
    cell.reset()
    assert cell.char == " "
    assert cell.fg is None
    assert cell.bg is None
    assert cell.style is None


def test_render_buffer_resize() -> None:
    """RenderBuffer resize 应正确扩展并保留内容。"""
    buf = RenderBuffer()
    buf.resize(3, 2)
    assert buf.width == 3
    assert buf.height == 2
    buf.set_cell(1, 1, "X", fg="ffffff")
    buf.resize(5, 4)
    assert buf.width == 5
    assert buf.height == 4
    assert buf.cells[1][1].char == "X"
    assert buf.cells[1][1].fg == "ffffff"


def test_render_buffer_clear() -> None:
    """RenderBuffer clear 应清空所有单元格。"""
    buf = RenderBuffer()
    buf.resize(2, 2)
    buf.set_cell(0, 0, "X")
    buf.clear()
    assert buf.cells[0][0].char == " "


def test_render_buffer_out_of_bounds() -> None:
    """越界 set_cell 应静默忽略。"""
    buf = RenderBuffer()
    buf.resize(2, 2)
    buf.set_cell(5, 5, "X")
    # 不应抛异常


def test_canvas_widget_render() -> None:
    """CanvasWidget render 应返回包含设置字符的 Rich Text。"""
    canvas = CanvasWidget()
    canvas._buffer.resize(3, 1)
    canvas.set_cell(1, 0, "X", fg="ffffff")
    text = canvas.render()
    assert "X" in text.plain
