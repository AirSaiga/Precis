# backend/app/cli/__main__.py
"""
@fileoverview CLI 入口启动模块

功能概述:
- 作为 python -m app.cli 的入口点启动交互式 CLI
- 委托给 shell.main.main 执行主循环
"""

import sys

from app.cli.shell.main import main

if __name__ == "__main__":
    sys.exit(main())
