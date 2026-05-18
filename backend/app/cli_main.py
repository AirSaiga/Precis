# backend/app/cli_main.py
"""
@fileoverview Precis CLI 入口模块

功能概述:
- 提供 `python app/cli_main.py` 直接启动交互式 CLI Shell 的能力
- 配置 PYTHONDONTWRITEBYTECODE 禁止生成字节码缓存
- 自动将 backend 目录加入 Python 路径

架构设计:
- 兼容两种启动方式: 直接运行与模块运行 (-m)
- 委托给 cli.shell.main 执行交互式 Shell 主循环

输入示例:
    python app/cli_main.py

输出示例:
    Precis CLI Shell 交互式界面
"""

import os

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import sys

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

try:
    from cli.shell.main import main
except ImportError:
    from app.cli.shell.main import main

if __name__ == "__main__":
    sys.exit(main())
