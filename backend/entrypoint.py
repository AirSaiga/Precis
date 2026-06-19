import os
import sys

# 添加 backend/ 目录到 Python 路径，确保 app 包可被导入
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.cli.shell.main import main

if __name__ == "__main__":
    sys.exit(main())
