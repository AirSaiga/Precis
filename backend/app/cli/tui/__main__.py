"""@fileoverview TUI 入口启动模块

作为 `python -m app.cli.tui` 的入口点启动终端界面，委托给 app.cli.tui.app.main。
"""

from app.cli.tui.app import main

raise SystemExit(main())
