"""Precis TUI 主题注册（基于 Textual 原生 Theme 系统）。

用 ``Theme`` 对象定义主题（而非 CSS 文件），通过 ``app.register_theme()`` 注册、
``app.theme = name`` 即时切换。所有主题共享同一套扩展 token（通过 ``variables``
注入 CSS），保证 ``styles/themes/*.tcss`` 中可以使用 ``$tui-*`` 变量而不必在每个
主题文件里重复声明局部变量。

扩展 token 命名：
- $tui-surface       最深背景（Screen 底色）
- $tui-panel         面板/卡片背景
- $tui-boost         elevated 高亮背景（header、selected row）
- $tui-element       输入框/按钮等控件背景
- $tui-border        默认边框
- $tui-border-active 焦点/活动态边框
- $tui-border-subtle 极淡分隔线
- $tui-text-muted    弱化文本
- $tui-text-disabled 禁用/占位文本

主题色值取自各社区官方调色板：
- tokyo-night: https://github.com/tokyo-night/tokyo-night-vscode-theme
- catppuccin:  https://catppuccin.com/palette/
- nord:        https://www.nordtheme.com/docs/colors-and-palettes
- neon:        Dracula 风格
- mimo:        Tokyo Night 灰度分层（OpenCode 风格，luminosity_spread 调小）
- opencode:    OpenCode 暖黑 + 苹果蓝 accent
- system:      适配终端默认色（低饱和度灰阶，作为安全回退）
"""

from __future__ import annotations

from textual.theme import Theme

# 主题注册顺序（F2 循环顺序）；首个为默认
THEME_ORDER = [
    "tokyo-night",
    "tokyo-night-mimo",
    "opencode",
    "catppuccin",
    "nord",
    "neon",
    "system",
]

DEFAULT_THEME = "tokyo-night-mimo"


def _vars(
    surface: str,
    panel: str,
    boost: str,
    element: str,
    border: str,
    border_active: str,
    border_subtle: str,
    text_muted: str,
    text_disabled: str,
) -> dict[str, str]:
    """打包扩展 token 为 Theme.variables 字典。

    所有值均为六位十六进制颜色字符串（system 主题使用透明占位）。
    """
    return {
        "tui-surface": surface,
        "tui-panel": panel,
        "tui-boost": boost,
        "tui-element": element,
        "tui-border": border,
        "tui-border-active": border_active,
        "tui-border-subtle": border_subtle,
        "tui-text-muted": text_muted,
        "tui-text-disabled": text_disabled,
    }


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
        luminosity_spread=0.12,
        text_alpha=0.9,
        variables=_vars(
            surface="#1a1b26",
            panel="#24283b",
            boost="#2f334d",
            element="#1f2335",
            border="#2d3548",
            border_active="#565f89",
            border_subtle="#1f2335",
            text_muted="#565f89",
            text_disabled="#414868",
        ),
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
        luminosity_spread=0.1,
        text_alpha=0.9,
        variables=_vars(
            surface="#1e1e2e",
            panel="#313244",
            boost="#3d3e52",
            element="#181825",
            border="#313244",
            border_active="#585b70",
            border_subtle="#181825",
            text_muted="#6c7086",
            text_disabled="#45475a",
        ),
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
        luminosity_spread=0.1,
        text_alpha=0.9,
        variables=_vars(
            surface="#2e3440",
            panel="#3b4252",
            boost="#434c5e",
            element="#2e3440",
            border="#434c5e",
            border_active="#5e81ac",
            border_subtle="#3b4252",
            text_muted="#4c566a",
            text_disabled="#434c5e",
        ),
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
        luminosity_spread=0.12,
        text_alpha=0.9,
        variables=_vars(
            surface="#282a36",
            panel="#44475a",
            boost="#4f5268",
            element="#1e1f29",
            border="#44475a",
            border_active="#6272a4",
            border_subtle="#1e1f29",
            text_muted="#6272a4",
            text_disabled="#44475a",
        ),
    ),
    # MiMo 风格：Tokyo Night 色板但 luminosity_spread 调小（灰度分层更微差）
    "tokyo-night-mimo": Theme(
        name="tokyo-night-mimo",
        primary="#7aa2f7",
        secondary="#7aa2f7",
        accent="#7aa2f7",
        success="#9ece6a",
        warning="#e0af68",
        error="#f7768e",
        foreground="#c0caf5",
        background="#16161e",
        surface="#16161e",
        panel="#1a1b26",
        boost="#24283b",
        dark=True,
        luminosity_spread=0.08,
        text_alpha=0.87,
        variables=_vars(
            surface="#16161e",
            panel="#1a1b26",
            boost="#24283b",
            element="#1f2335",
            border="#2d3548",
            border_active="#414868",
            border_subtle="#1f2335",
            text_muted="#565f89",
            text_disabled="#414868",
        ),
    ),
    # OpenCode 风格：暖黑底 + 苹果蓝 accent + 扁平无阴影
    "opencode": Theme(
        name="opencode",
        primary="#007aff",
        secondary="#5ac8fa",
        accent="#007aff",
        success="#30d158",
        warning="#ff9f0a",
        error="#ff3b30",
        foreground="#fdfcfc",
        background="#201d1d",
        surface="#201d1d",
        panel="#302c2c",
        boost="#3d3838",
        dark=True,
        luminosity_spread=0.06,
        text_alpha=0.92,
        variables=_vars(
            surface="#201d1d",
            panel="#302c2c",
            boost="#3d3838",
            element="#282424",
            border="#464343",
            border_active="#646262",
            border_subtle="#302c2c",
            text_muted="#9a9898",
            text_disabled="#646262",
        ),
    ),
    # System 风格：低饱和度、接近终端默认色，作为安全回退
    "system": Theme(
        name="system",
        primary="#6b7280",
        secondary="#4b5563",
        accent="#2563eb",
        success="#16a34a",
        warning="#d97706",
        error="#dc2626",
        foreground="#e5e7eb",
        background="#0f0f0f",
        surface="#0f0f0f",
        panel="#1a1a1a",
        boost="#262626",
        dark=True,
        luminosity_spread=0.05,
        text_alpha=0.9,
        variables=_vars(
            surface="#0f0f0f",
            panel="#1a1a1a",
            boost="#262626",
            element="#141414",
            border="#333333",
            border_active="#555555",
            border_subtle="#1a1a1a",
            text_muted="#6b7280",
            text_disabled="#444444",
        ),
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
