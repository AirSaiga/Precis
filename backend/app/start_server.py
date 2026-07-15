"""
@fileoverview Precis 后端服务启动脚本

功能概述:
- 后端启动的统一入口,被 Electron 桌面应用与 Web 开发模式(npm run dev)共用
- 端口由 OS 原子分配(默认 port=0),通过 ``.backend-port`` 文件向外部发布实际端口
- 支持自定义端口(固定端口逃生舱)与热重载(开发模式)

使用方式:
    python app/start_server.py                 # OS 动态分配端口(Electron 用)
    python app/start_server.py --reload        # 开发模式热重载(npm run dev / backend:dev 用)
    python app/start_server.py --port 18000    # 固定端口(向后兼容)
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

from app.shared.core.config.server import (
    DEFAULT_BACKEND_HOST,
    acquire_port,
    clear_port_file,
    register_port_file_cleanup,
    resolve_port,
    write_port_file,
)

logger = logging.getLogger(__name__)


def main():
    """
    主函数 - 解析命令行参数并启动 Uvicorn 服务器

    端口策略:
    - 默认 port=0 由 OS 动态分配(永不冲突),实际端口写入 .backend-port
    - 显式 --port 或 VITE_BACKEND_PORT 环境变量可固定端口(向后兼容)
    """
    # 创建命令行参数解析器
    parser = argparse.ArgumentParser(description="Precis Backend Server", prog="start_server")

    # 添加端口参数
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="服务器监听端口 (默认: 0=OS 动态分配;可通过 VITE_BACKEND_PORT 固定端口)",
    )

    # 添加主机参数
    parser.add_argument(
        "--host", type=str, default=DEFAULT_BACKEND_HOST, help=f"服务器监听地址 (默认: {DEFAULT_BACKEND_HOST})"
    )

    # 添加热重载参数(开发模式用,Electron 生产模式不启用)
    parser.add_argument(
        "--reload",
        action="store_true",
        help="启用文件变更热重载(仅开发模式使用)",
    )

    # 解析参数
    args = parser.parse_args()

    # 解析端口:CLI 参数 > 环境变量 > 默认 0(OS 动态分配)
    preferred_port = resolve_port(args.port)
    # 获取实际可监听端口(OS 原子分配,无竞态)
    actual_port = acquire_port(preferred_port)

    # 将实际端口写入端口文件,供 Vite 代理 / Electron 主进程发现
    write_port_file(actual_port)

    # 注册端口文件清理兜底(atexit + signal),Windows 下 uvicorn 的信号处理可能绕过 finally
    register_port_file_cleanup()

    # 打印启动信息
    logger.info("[INIT] Precis Backend 启动中...")
    logger.info("[INIT] 监听地址: %s:%s", args.host, actual_port)
    logger.info("[INIT] Python 版本: %s", sys.version)

    try:
        # 启动 Uvicorn 服务器
        # app.api.main:app 指向 FastAPI 应用实例
        uvicorn.run(
            "app.api.main:app",
            host=args.host,
            port=actual_port,
            log_level="info",
            # 热重载:开发模式 --reload 启用,Electron 生产模式关闭
            reload=args.reload,
            # 启用访问日志
            access_log=True,
        )
    finally:
        # 无论正常退出还是异常中断,都清理端口文件,避免残留误导外部发现方
        clear_port_file()


if __name__ == "__main__":
    main()
