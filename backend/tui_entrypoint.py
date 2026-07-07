"""PyInstaller 入口脚本：precis-tui。

由 backend/precis-tui.spec 引用，作用等同于 entrypoint.py（precis 的入口）：
把 backend/ 目录加入 sys.path 后启动 TUI 主应用。
"""

import os
import sys

# 添加 backend/ 目录到 Python 路径，确保 app 包可被导入
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.cli.tui.app import main

if __name__ == "__main__":
    sys.exit(main())
