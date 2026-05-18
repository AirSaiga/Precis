"""
@fileoverview AI 路由包入口

功能概述:
- 作为 AI 相关 API 路由的统一出口
- 从 router 模块导入主路由实例，保持与旧代码的兼容性
- 导出 models 子模块供外部使用

输入示例:
    from app.api.routers.ai import router
    app.include_router(router, prefix="/ai")

输出示例:
    router: APIRouter 实例，包含所有 AI 相关端点
    models: AI 相关数据模型子模块
"""

from . import models
from .router import router

__all__ = ["router", "models"]
