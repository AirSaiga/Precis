"""CanvasWidget：字符网格渲染基座。

维护一个二维字符缓冲区，每个单元格包含字符、前景色、背景色和样式。
通过定时刷新实现动画效果。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from rich.text import Text
from textual.widgets import Static


@dataclass
class Cell:
    """Canvas 上的一个字符单元格。"""

    char: str = " "
    fg: str | None = None  # 前景色，十六进制如 "ff79c6"
    bg: str | None = None  # 背景色，十六进制如 "282a36"
    style: str | None = None  # 额外样式，如 "bold", "dim"

    def reset(self) -> None:
        """清空单元格为默认状态。"""
        self.char = " "
        self.fg = None
        self.bg = None
        self.style = None

    def to_style(self) -> str:
        """转换为 Rich 样式字符串。"""
        parts: list[str] = []
        if self.fg:
            parts.append(f"#{self.fg}")
        if self.bg:
            parts.append(f"on #{self.bg}")
        if self.style:
            parts.append(self.style)
        return " ".join(parts)


@dataclass
class RenderBuffer:
    """二维渲染缓冲区。"""

    width: int = 0
    height: int = 0
    cells: list[list[Cell]] = field(default_factory=list)

    def resize(self, width: int, height: int) -> None:
        """调整缓冲区大小，保留已有内容（尽可能）。"""
        width = max(width, 1)
        height = max(height, 1)
        new_cells: list[list[Cell]] = []
        for y in range(height):
            row: list[Cell] = []
            for x in range(width):
                if y < self.height and x < self.width:
                    row.append(self.cells[y][x])
                else:
                    row.append(Cell())
            new_cells.append(row)
        self.width = width
        self.height = height
        self.cells = new_cells

    def clear(self) -> None:
        """清空整个缓冲区。"""
        for row in self.cells:
            for cell in row:
                cell.reset()

    def set_cell(
        self, x: int, y: int, char: str, fg: str | None = None, bg: str | None = None, style: str | None = None
    ) -> None:
        """设置指定单元格。"""
        if not (0 <= x < self.width and 0 <= y < self.height):
            return
        cell = self.cells[y][x]
        cell.char = char[:1] if char else " "
        cell.fg = fg
        cell.bg = bg
        cell.style = style

    def blend(
        self,
        x: int,
        y: int,
        char: str,
        fg: str | None = None,
        bg: str | None = None,
        style: str | None = None,
        alpha: float = 1.0,
    ) -> None:
        """带透明度混合设置单元格（alpha 仅对背景色做简单覆盖判断）。"""
        if not (0 <= x < self.width and 0 <= y < self.height):
            return
        if alpha <= 0:
            return
        cell = self.cells[y][x]
        cell.char = char[:1] if char else " "
        if alpha >= 1.0:
            cell.fg = fg
            cell.bg = bg
            cell.style = style
        else:
            # 半透明时仅当原单元格为空才覆盖，模拟简单混合
            if cell.char == " ":
                cell.fg = fg
                cell.bg = bg
                cell.style = f"{style} dim" if style else "dim"


class CanvasWidget(Static):
    """字符网格画布 Widget。

    可被 EffectEngine 驱动，定时刷新实现动画。
    """

    DEFAULT_CSS = """
    CanvasWidget {
        width: 100%;
        height: 100%;
        background: transparent;
        color: transparent;
    }
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._buffer = RenderBuffer()
        self._needs_resize = True

    def on_mount(self) -> None:
        """挂载时初始化缓冲区大小。"""
        self._resize()

    def on_resize(self) -> None:
        """尺寸变化时调整缓冲区。"""
        self._resize()

    def _resize(self) -> None:
        """根据当前 Widget 尺寸调整缓冲区。"""
        size = self.size
        if size.width <= 0 or size.height <= 0:
            return
        self._buffer.resize(size.width, size.height)
        self._needs_resize = False

    @property
    def buffer(self) -> RenderBuffer:
        """返回渲染缓冲区。"""
        return self._buffer

    @property
    def canvas_width(self) -> int:
        """当前画布宽度。"""
        return self._buffer.width

    @property
    def canvas_height(self) -> int:
        """当前画布高度。"""
        return self._buffer.height

    def clear(self) -> None:
        """清空画布。"""
        self._buffer.clear()

    def set_cell(
        self, x: int, y: int, char: str, fg: str | None = None, bg: str | None = None, style: str | None = None
    ) -> None:
        """设置单个单元格。"""
        self._buffer.set_cell(x, y, char, fg, bg, style)

    def blend(
        self,
        x: int,
        y: int,
        char: str,
        fg: str | None = None,
        bg: str | None = None,
        style: str | None = None,
        alpha: float = 1.0,
    ) -> None:
        """半透明设置单元格。"""
        self._buffer.blend(x, y, char, fg, bg, style, alpha)

    def render(self) -> Text:
        """将缓冲区渲染为 Rich Text。

        性能优化：空白 cell（空格且无样式）跳过 to_style 调用，
        直接用无样式的 append。CanvasWidget 大部分 cell 是空白，
        这能省掉 80%+ 的 to_style + Style 构造开销。
        """
        if self._needs_resize:
            self._resize()
        lines: list[Text] = []
        for row in self._buffer.cells:
            line = Text()
            # 先统计连续空白段，批量追加空格，再处理非空 cell
            spaces = 0
            for cell in row:
                if cell.char == " " and not cell.fg and not cell.bg and not cell.style:
                    # 空白 cell：累加，稍后一次性追加
                    spaces += 1
                    continue
                # 遇到非空 cell，先 flush 累积的空白
                if spaces:
                    line.append(" " * spaces)
                    spaces = 0
                line.append(cell.char, cell.to_style())
            if spaces:
                line.append(" " * spaces)
            lines.append(line)
        if not lines:
            return Text("")
        return Text("\n").join(lines)
