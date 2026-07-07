"""TUI 屏幕模块。

各功能屏（Screen）放在此处，每个屏对应一个用户场景（如校验、Provider 管理、
配置管理、AI 对话、生成/迁移）。P1-P5 各自独占一个 screen 文件，通过
``tui.protocols.register_screen`` 注册到 SCREEN_REGISTRY 供 P6 装配。
"""
