"""Precis TUI 主题注册（基于 Textual 原生 Theme 系统）。

用 ``Theme`` 对象定义主题（而非 CSS 文件），通过 ``app.register_theme()`` 注册、
``app.theme = name`` 即时切换。这是 Textual 运行时切主题的正确方式——所有用
``$primary``/``$surface``/``$panel`` 等内置 design token 的 widget 都会自动跟随。

主题色值取自各社区官方调色板：
- tokyo-night: https://github.com/tokyo-night/tokyo-night-vscode-theme
- catppuccin:  https://catppuccin.com/palette/
- nord:        https://www.nordtheme.com/docs/colors-and-palettes
- neon:        Dracula 风格
- mimo:        Tokyo Night 灰度分层（OpenCode 风格，luminosity_spread 调小）
"""

from __future__ import annotations

from textual.theme import Theme

# 主题注册顺序（F2 循环顺序）；首个为默认
THEME_ORDER = [
    "tokyo-night",
    "catppuccin",
    "nord",
    "neon",
    "tokyo-night-mimo",
]

DEFAULT_THEME = "tokyo-night"

# ── 主题定义 ──

_THEMES: dict[str, Theme] = {
    "tokyo-night": Theme(
        name="tokyo-night",
        primary="#7aa2f7",
        secondary="#bb9af7",
        accent="#bb9af7",
        success="#9ece6a",
        warning="#e0af68",
        error="#f7768e",
        foreground="#c0caf5",
        background="#1a1b26",
        surface="#1a1b26",
        panel="#24283b",
        boost="#414868",
        dark=True,
    ),
    "catppuccin": Theme(
        name="catppuccin",
        primary="#cba6f7",
        secondary="#89b4fa",
        accent="#f5c2e7",
        success="#a6e3a1",
        warning="#f9e2af",
        error="#f38ba8",
        foreground="#cdd6f4",
        background="#1e1e2e",
        surface="#1e1e2e",
        panel="#313244",
        boost="#45475a",
        dark=True,
    ),
    "nord": Theme(
        name="nord",
        primary="#88c0d0",
        secondary="#81a1c1",
        accent="#b48ead",
        success="#a3be8c",
        warning="#ebcb8b",
        error="#bf616a",
        foreground="#eceff4",
        background="#2e3440",
        surface="#2e3440",
        panel="#3b4252",
        boost="#4c566a",
        dark=True,
    ),
    "neon": Theme(
        name="neon",
        primary="#bd93f9",
        secondary="#8be9fd",
        accent="#ff79c6",
        success="#50fa7b",
        warning="#ffb86c",
        error="#ff5555",
        foreground="#f8f8f2",
        background="#282a36",
        surface="#282a36",
        panel="#44475a",
        boost="#6272a4",
        dark=True,
    ),
    # MiMo 风格：Tokyo Night 色板但 luminosity_spread 调小（灰度分层更微差）
    # 边框/背景层次更收敛，接近 OpenCode 的简约高级感
    "tokyo-night-mimo": Theme(
        name="tokyo-night-mimo",
        primary="#7aa2f7",
        secondary="#7aa2f7",  # 与 primary 同色，收敛配色
        accent="#7aa2f7",
        success="#9ece6a",
        warning="#e0af68",
        error="#f7768e",
        foreground="#c0caf5",
        background="#16161e",  # 比标准 tokyo-night 更深
        surface="#16161e",
        panel="#1a1b26",
        boost="#24283b",
        dark=True,
        luminosity_spread=0.08,  # 缩小明暗梯度（灰度分层更微妙）
        text_alpha=0.87,  # 文字略柔（不刺眼）
    ),
}


def register_all_themes(app) -> None:
    """向 App 注册全部主题。

    在 App.on_mount 中调用一次即可。注册后可用 ``app.theme = "name"`` 切换。

    Args:
        app: Textual App 实例。
    """
    for theme in _THEMES.values():
        app.register_theme(theme)


def get_theme(name: str) -> Theme | None:
    """按名取主题定义（未注册的返回 None）。"""
    return _THEMES.get(name)
