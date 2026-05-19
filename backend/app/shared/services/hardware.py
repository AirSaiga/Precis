"""@fileoverview 系统硬件信息采集模块

功能概述:
- 采集操作系统、CPU、内存、磁盘、GPU 等硬件信息
- 提供 HardwareSnapshot 数据类用于性能优化和错误报告
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HardwareSnapshot:
    """
    @classdesc 硬件快照数据类

    使用 frozen=True 确保实例不可变，线程安全。

    字段说明：
    - os_name: 操作系统名称（如 'Windows', 'Linux'）
    - os_version: 操作系统版本号
    - arch: 系统架构（如 'x86_64', 'AMD64'）
    - cpu_cores: CPU 逻辑核心数
    - memory_total_bytes: 物理内存总量（字节）
    - disk_free_bytes: 磁盘可用空间（字节）
    - has_nvidia_gpu: 是否存在 NVIDIA GPU
    """

    os_name: str
    os_version: str
    arch: str
    cpu_cores: int
    memory_total_bytes: int
    disk_free_bytes: int
    has_nvidia_gpu: bool


def _cpu_cores() -> int:
    """
    @methoddesc 获取 CPU 逻辑核心数

    实现逻辑：
    1. 尝试使用 os.cpu_count() 获取核心数
    2. 异常处理：若获取失败，返回默认值 1

    返回:
        CPU 逻辑核心数，至少为 1
    """
    try:
        v = int(os.cpu_count() or 0)
    except Exception:
        logger.debug("获取 CPU 核心数失败", exc_info=True)
        v = 0
    return v if v > 0 else 1


def _memory_total_bytes() -> int:
    """
    @methoddesc 获取系统物理内存总量

    平台实现：
    - Windows: 使用 ctypes 调用 kernel32.GlobalMemoryStatusEx
    - Linux/Unix: 使用 os.sysconf 获取页大小和物理页数

    返回:
        物理内存总量（字节），获取失败返回 0
    """
    # Windows 平台实现
    if os.name == "nt":
        try:
            import ctypes

            # 定义 Windows MEMORYSTATUSEX 结构体
            class _MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),  # 结构体大小
                    ("dwMemoryLoad", ctypes.c_ulong),  # 内存使用率
                    ("ullTotalPhys", ctypes.c_ulonglong),  # 物理内存总量
                    ("ullAvailPhys", ctypes.c_ulonglong),  # 物理内存可用量
                    ("ullTotalPageFile", ctypes.c_ulonglong),  # 页面文件总量
                    ("ullAvailPageFile", ctypes.c_ulonglong),  # 页面文件可用量
                    ("ullTotalVirtual", ctypes.c_ulonglong),  # 虚拟内存总量
                    ("ullAvailVirtual", ctypes.c_ulonglong),  # 虚拟内存可用量
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),  # 扩展虚拟内存
                ]

            stat = _MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
            # 调用 Windows API 获取内存状态
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)) == 0:
                return 0
            return int(stat.ullTotalPhys)
        except Exception:
            logger.debug("Windows 平台获取内存总量失败", exc_info=True)
            return 0

    # Linux/Unix 平台实现
    if hasattr(os, "sysconf"):
        try:
            # 获取系统页大小（字节）
            page = int(os.sysconf("SC_PAGE_SIZE"))
            # 获取物理内存页数
            pages = int(os.sysconf("SC_PHYS_PAGES"))
            total = page * pages
            return int(total) if total > 0 else 0
        except Exception:
            logger.debug("Linux/Unix 平台获取内存总量失败", exc_info=True)
            return 0

    return 0


def _disk_free_bytes(path: str | None = None) -> int:
    r"""
    @methoddesc 获取指定路径所在磁盘的可用空间

    路径解析逻辑：
    - 若指定 path 参数：使用该路径
    - 若未指定：
      - Windows: 使用系统驱动器（默认 C:\）
      - Linux/Unix: 使用用户主目录

    参数:
        path: 可选的磁盘路径

    返回:
        可用空间（字节），获取失败返回 0
    """
    p = path
    if not p:
        if os.name == "nt":
            # Windows: 使用系统驱动器
            p = os.environ.get("SystemDrive", "C:") + "\\"
        else:
            # Linux/Unix: 使用用户主目录
            p = os.path.expanduser("~")
    try:
        usage = shutil.disk_usage(p)
        return int(usage.free)
    except Exception:
        logger.debug(f"获取磁盘可用空间失败: path={p}", exc_info=True)
        return 0


def _has_nvidia_gpu(timeout_seconds: float = 1.2) -> bool:
    """
    @methoddesc 检测系统是否装有 NVIDIA GPU

    实现机制：
    通过执行 nvidia-smi -L 命令检测 GPU 存在性。
    使用较短的超时时间（默认 1.2 秒）避免长时间阻塞。

    参数:
        timeout_seconds: 命令执行超时时间（秒）

    返回:
        存在 NVIDIA GPU 返回 True，否则返回 False
    """
    try:
        # 执行 nvidia-smi -L 命令检测GPU
        res = subprocess.run(
            ["nvidia-smi", "-L"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            check=False,
        )
        # 返回码为0表示命令成功执行，即存在GPU
        return res.returncode == 0
    except Exception:
        logger.debug("NVIDIA GPU 检测失败", exc_info=True)
        return False


def snapshot() -> HardwareSnapshot:
    """
    @methoddesc 获取当前系统的硬件信息快照

    采集的信息：
    1. 操作系统信息：
       - os_name: platform.system() 或 os.name
       - os_version: platform.version() 或 platform.release()
    2. 系统架构：platform.machine() 或 platform.architecture()
    3. CPU 核心数：_cpu_cores()
    4. 内存总量：_memory_total_bytes()
    5. 磁盘可用空间：_disk_free_bytes()
    6. GPU 检测：_has_nvidia_gpu()

    返回:
        HardwareSnapshot 实例，包含所有硬件信息
    """
    # 采集操作系统信息
    os_name = platform.system() or os.name
    os_version = platform.version() or platform.release() or ""
    arch = platform.machine() or platform.architecture()[0] or sys.platform

    # 采集各项硬件指标
    cpu_cores = _cpu_cores()
    memory_total = _memory_total_bytes()
    disk_free = _disk_free_bytes()
    has_gpu = _has_nvidia_gpu()

    # 构建并返回硬件快照
    return HardwareSnapshot(
        os_name=os_name,
        os_version=os_version,
        arch=arch,
        cpu_cores=cpu_cores,
        memory_total_bytes=memory_total,
        disk_free_bytes=disk_free,
        has_nvidia_gpu=has_gpu,
    )
