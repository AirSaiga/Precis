"""TUI 特效系统（fx）。

提供基于字符网格的粒子、星空、庆祝等视觉效果，用于增强 Precis TUI 的现代感。
特效层位于 Textual Widget 体系之上，通过自定义 CanvasWidget 实现字符级渲染。
"""

from app.cli.tui.fx.canvas import CanvasWidget, Cell
from app.cli.tui.fx.engine import EffectEngine
from app.cli.tui.fx.meteor import MeteorEffect

__all__ = ["CanvasWidget", "Cell", "EffectEngine", "MeteorEffect"]
