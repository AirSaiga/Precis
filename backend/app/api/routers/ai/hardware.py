"""
@fileoverview AI 硬件诊断 API 路由模块

功能概述:
- 诊断本地硬件环境（CPU、内存、磁盘、GPU）
- 评估运行本地 AI 模型的硬件条件
- 提供不同规模模型的硬件需求参考

架构设计:
- 使用 psutil 获取系统硬件信息
- 通过 NVIDIA nvidia-smi 检测 GPU（如可用）
- 返回硬件需求检查项和优化建议

输入示例:
    GET /ai/hardware/diagnose

输出示例:
    {
        "platform": "Windows-10-...",
        "cpu": {"name": "CPU", "value": {"cores": 8, ...}},
        "memory": {"name": "Memory", "value": {"total_gb": 16, ...}},
        "requirements": [
            {"name": "Memory for 7B model", "required": "8 GB", "current": "16.0 GB", "satisfied": true}
        ],
        "recommendations": []
    }
"""

import logging
import platform
from typing import Any

import psutil

from .models import HardwareDiagnoseResponse, HardwareInfo, HardwareRequirement
from .router import router


@router.get("/hardware/diagnose", response_model=HardwareDiagnoseResponse)
def diagnose_hardware() -> HardwareDiagnoseResponse:
    """
    诊断本地硬件环境

    检查 CPU、内存、磁盘等硬件信息，评估运行本地 AI 模型的条件
    """
    # 获取系统信息
    platform_name = platform.platform()

    # CPU 信息
    cpu_count = psutil.cpu_count(logical=True)
    cpu_freq = psutil.cpu_freq()
    cpu_info = HardwareInfo(
        name="CPU",
        value={
            "cores": cpu_count,
            "frequency_mhz": cpu_freq.max if cpu_freq else None,
            "usage_percent": psutil.cpu_percent(interval=0.1),
        },
    )

    # 内存信息
    memory = psutil.virtual_memory()
    memory_info = HardwareInfo(
        name="Memory",
        value={
            "total_gb": round(memory.total / (1024**3), 2),
            "available_gb": round(memory.available / (1024**3), 2),
            "percent": memory.percent,
        },
    )

    # 磁盘信息
    disk = psutil.disk_usage("/")
    disk_info = HardwareInfo(
        name="Disk",
        value={
            "total_gb": round(disk.total / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": disk.percent,
        },
    )

    # GPU 信息（简化，实际需要更复杂的检测）
    gpu_info = []
    try:
        # 尝试检测 NVIDIA GPU
        import subprocess

        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"], capture_output=True, text=True
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if line:
                    parts = line.split(",")
                    if len(parts) >= 2:
                        gpu_info.append(
                            HardwareInfo(name=f"GPU: {parts[0].strip()}", value={"memory": parts[1].strip()})
                        )
    except Exception:
        logging.exception("GPU信息检测失败")

    # 构建需求检查
    requirements: list[HardwareRequirement] = []
    recommendations: list[str] = []

    # 内存检查（运行 7B 模型建议至少 8GB）
    memory_gb = memory.total / (1024**3)
    if memory_gb < 8:
        requirements.append(
            HardwareRequirement(
                name="Memory for 7B model", required="8 GB", current=f"{memory_gb:.1f} GB", satisfied=False
            )
        )
        recommendations.append("建议增加内存至 8GB 以上以运行 7B 参数模型")
    else:
        requirements.append(
            HardwareRequirement(
                name="Memory for 7B model", required="8 GB", current=f"{memory_gb:.1f} GB", satisfied=True
            )
        )

    # 磁盘空间检查
    disk_free_gb = disk.free / (1024**3)
    if disk_free_gb < 10:
        requirements.append(
            HardwareRequirement(
                name="Disk space for models", required="10 GB", current=f"{disk_free_gb:.1f} GB", satisfied=False
            )
        )
        recommendations.append("磁盘空间不足，建议清理空间或更换存储位置")
    else:
        requirements.append(
            HardwareRequirement(
                name="Disk space for models", required="10 GB", current=f"{disk_free_gb:.1f} GB", satisfied=True
            )
        )

    return HardwareDiagnoseResponse(
        platform=platform_name,
        cpu=cpu_info,
        memory=memory_info,
        disk=disk_info,
        gpu=gpu_info if gpu_info else None,
        requirements=requirements,
        recommendations=recommendations,
    )


@router.get("/hardware/requirements/{model_size}")
def get_hardware_requirements(model_size: str) -> dict[str, Any]:
    """
    获取指定规模模型的硬件需求

    model_size: 如 "7b", "13b", "70b"
    """
    requirements = {
        "7b": {"memory_gb": 8, "disk_gb": 4, "cpu_cores": 4, "description": "适合个人开发和轻量级使用"},
        "13b": {"memory_gb": 16, "disk_gb": 8, "cpu_cores": 8, "description": "适合中等复杂度任务"},
        "70b": {"memory_gb": 64, "disk_gb": 40, "cpu_cores": 16, "description": "适合企业级复杂任务，建议配备 GPU"},
    }

    return requirements.get(model_size.lower(), {"error": f"Unknown model size: {model_size}"})
