"""@fileoverview 后端服务启动配置单一事实源

功能概述:
- 集中管理后端端口、主机、端口文件协议等启动相关配置
- 提供 OS 原子端口分配(避免固定端口的冲突面与 TOCTOU 竞态)
- 通过 ``.backend-port`` 文件向外部(Vite 代理 / Electron 主进程)发布实际端口

设计原则:
- 本模块位于 ``core/`` 层(基础设施),含 socket + 文件 I/O,不违反三层分离
- 所有启动入口(``start_server.py`` / ``cli/start.py``)统一从此模块取配置
- ``VITE_BACKEND_PORT`` 环境变量作为"固定端口逃生舱"保留向后兼容;
  未设置时使用 ``port=0`` 由 OS 动态分配
"""

from __future__ import annotations

import os
import socket
from pathlib import Path

# ============================================================================
# 常量(单一事实源)
# ============================================================================

#: 后端默认端口。0 = 由 OS 动态分配(推荐);正数 = 固定端口
DEFAULT_BACKEND_PORT = 0

#: 后端默认监听地址(loopback,不暴露到网络)
DEFAULT_BACKEND_HOST = "127.0.0.1"

#: 端口文件名,写在后端 cwd(即 ``backend/``)下,内容为纯端口号
BACKEND_PORT_FILE = ".backend-port"


# ============================================================================
# 端口解析
# ============================================================================


def resolve_port(cli_port: int | None) -> int:
    """确定后端监听端口。

    优先级(高 → 低):
        1. CLI 参数 ``--port``(显式指定)
        2. 环境变量 ``VITE_BACKEND_PORT``(向后兼容的固定端口逃生舱)
        3. 默认值 ``DEFAULT_BACKEND_PORT``(=0,OS 动态分配)

    Args:
        cli_port: 命令行传入的端口号;None 表示未指定

    Returns:
        最终使用的端口号。0 表示交由 OS 动态分配。
    """
    if cli_port is not None:
        return cli_port

    env_port = os.environ.get("VITE_BACKEND_PORT")
    if env_port:
        try:
            return int(env_port)
        except ValueError:
            pass

    return DEFAULT_BACKEND_PORT


# ============================================================================
# OS 原子端口分配
# ============================================================================


def acquire_port(preferred: int = 0) -> int:
    """获取一个可监听的端口。

    - ``preferred == 0``:通过 ``socket.bind(('127.0.0.1', 0))`` 让 OS 原子分配一个
      临时端口。这是 loopback 单机场景下最安全的方式——无递归、无竞态、永不冲突。
    - ``preferred > 0``:直接返回该端口号,由调用方(uvicorn)负责绑定;若已被占用
      会在 uvicorn 启动时报错(固定端口是用户显式选择的,可接受)。

    Note:
        对于 ``preferred == 0``,bind 后立即 close 再把端口交给 uvicorn,存在极小的
        TOCTOU 窗口(另一进程抢占)。但 loopback 单机场景下概率极低且可接受——
        这与 Electron 旧 ``findAvailablePort`` 同理,但更简单(无递归)。

    Args:
        preferred: 期望端口。0 = OS 分配。

    Returns:
        可用的端口号。
    """
    if preferred > 0:
        return preferred

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((DEFAULT_BACKEND_HOST, 0))
        # getsockname() 返回 tuple,取 [1] 为端口;mypy 将其推断为 Any,用 int() 收窄类型
        return int(s.getsockname()[1])


# ============================================================================
# 端口文件协议
# ============================================================================


def _port_file_path() -> Path:
    """返回端口文件路径(后端 cwd 下)。

    后端进程的 cwd 是 ``backend/``,故端口文件落在 ``backend/.backend-port``。
    """
    return Path.cwd() / BACKEND_PORT_FILE


def write_port_file(port: int) -> None:
    """将实际端口写入 ``.backend-port`` 文件,供 Vite 代理 / Electron 主进程发现。

    写入前若文件已存在(上次异常退出残留),先覆盖。
    """
    _port_file_path().write_text(str(port), encoding="utf-8")


def clear_port_file() -> None:
    """删除端口文件(后端退出时清理)。文件不存在时静默忽略。"""
    try:
        _port_file_path().unlink(missing_ok=True)
    except OSError:
        # 权限或并发问题:端口文件残留不影响下次启动(会被覆盖),忽略
        pass


def register_port_file_cleanup() -> None:
    """注册端口文件清理的兜底机制(atexit + signal)。

    Windows 下 uvicorn 收到 SIGINT/异常后,调用方的 finally 不一定执行
    (信号处理链路与 Unix 不同)。此函数注册多重清理兜底,多次调用安全。

    应在 write_port_file() 之后、uvicorn.run() 之前调用。
    """
    import atexit
    import signal

    atexit.register(clear_port_file)
    signal.signal(signal.SIGTERM, lambda *_: clear_port_file())
    try:
        signal.signal(signal.SIGINT, lambda *_: clear_port_file())
    except (OSError, ValueError):
        # 某些环境(如嵌入运行时)无法注册 SIGINT,忽略
        pass


__all__ = [
    "DEFAULT_BACKEND_PORT",
    "DEFAULT_BACKEND_HOST",
    "BACKEND_PORT_FILE",
    "resolve_port",
    "acquire_port",
    "write_port_file",
    "clear_port_file",
    "register_port_file_cleanup",
]
