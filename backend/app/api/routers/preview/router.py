"""
@fileoverview 文件预览路由入口模块

功能概述:
- 创建并导出文件预览模块的 FastAPI APIRouter 实例
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/preview", tags=["File Preview"])


__all__ = ["router"]
