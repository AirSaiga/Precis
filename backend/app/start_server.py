"""
@fileoverview Precis 后端服务启动脚本

功能概述:
- 用于 Electron 桌面应用启动 Python 后端服务
- 支持自定义端口配置
- 提供优雅的服务启动和停止机制

使用方式:
    python -m app.start_server --port 18000
    python backend/app/start_server.py --port 18000
"""

import os

# 禁止生成 Python 字节码文件（__pycache__ 和 .pyc）
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

import argparse
import logging
import sys

# 添加项目根目录（backend/）到 Python 路径
# 由于脚本位于 backend/app/ 下，需要上溯两级到 backend/
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import uvicorn

logger = logging.getLogger(__name__)


def main():
    """
    主函数 - 解析命令行参数并启动 Uvicorn 服务器
    """
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description="Precis Backend Server", prog="start_server")

    # 添加端口参数
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("VITE_BACKEND_PORT", 18000)),
        help="服务器监听端口 (默认: 18000，可通过 VITE_BACKEND_PORT 覆盖)",
    )

    # 添加主机参数
    parser.add_argument("--host", type=str, default="127.0.0.1", help="服务器监听地址 (默认: 127.0.0.1)")

    # 解析参数
    args = parser.parse_args()

    # 打印启动信息
    logger.info("[INIT] Precis Backend 启动中...")
    logger.info("[INIT] 监听地址: %s:%s", args.host, args.port)
    logger.info("[INIT] Python 版本: %s", sys.version)

    # 启动 Uvicorn 服务器
    # app.api.main:app 指向 FastAPI 应用实例
    uvicorn.run(
        "app.api.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
        # 禁用自动重载，避免 Electron 环境下出现问题
        reload=False,
        # 启用访问日志
        access_log=True,
    )


if __name__ == "__main__":
    main()
