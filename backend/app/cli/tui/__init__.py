"""Precis TUI（终端界面）包。

TUI 是 CLI 之外的第二套交互界面，基于 Textual 构建。本包只负责 UI 层
（屏幕、组件、输入输出），核心业务逻辑全部复用 app.shared.* 与（P0b 抽出后的）
app.cli.shared_services.*，确保 CLI 与 TUI 同源、改一处即可生效。

目录约定：
- app.py：TUI 主应用（PrecisTUIApp）与启动入口
- protocols.py：service 层共享协议（ProjectState、register_screen），约束 P1-P5
- screens/：各功能屏（P1-P5 各自独占一个 screen 文件）
- widgets/：可复用组件（历史列表、命令面板、状态条等）
- services/：TUI service 层（薄包装，调 shared_services 与 app.shared）
- styles/app.tcss：Textual 样式表
"""

from __future__ import annotations
