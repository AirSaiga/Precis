"""
@fileoverview 数据校验路由入口模块

功能概述:
- 创建并导出数据校验模块的 FastAPI APIRouter 实例
- 作为数据校验相关路由的注册入口，供上层应用统一挂载

架构设计:
- 使用 FastAPI 的 APIRouter 创建路由实例
- 设置 tags=["Data Validation"] 便于 Swagger/OpenAPI 文档分类展示
- prefix 由上层应用通过 include_router 时指定，本模块保持为空

输入示例:
    from app.api.routers.validation.router import router
    app.include_router(router, prefix="/validation")

输出示例:
    无直接输出，提供配置好的 APIRouter 实例
"""

from __future__ import annotations

from fastapi import APIRouter

# 创建数据校验模块的路由实例，tags 用于在 API 文档中分组展示
router = APIRouter(prefix="", tags=["Data Validation"])

# 导入子模块以注册其路由（content_mode 和 path_mode 通过 from .router import router 装饰本实例）
from . import content_mode, path_mode  # noqa: E402, F401

__all__ = ["router"]
