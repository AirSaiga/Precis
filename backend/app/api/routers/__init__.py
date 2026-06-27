"""
@fileoverview API 路由聚合入口模块

功能概述:
- 聚合并导出所有子模块的路由器实例
- 统一暴露项目、AI、预览、校验、工作空间等路由

说明:
- 所有路由器（含 AI）均在包导入时直接实例化并注册端点，确保 `app.include_router`
  在任意环境（Linux/Windows、Py3.12/3.13）下都能确定性地拷贝到全部路由。
- 此前曾用 `_LazyAIRouter` 代理延迟加载 AI 路由，但其 `__getattr__` 转发在
  CI(Linux) 环境下会导致 stream.py 等子模块的端点不稳定地漏注册（manifest 为
  /ai/jobs/{id}/cancel、/ai/chat/{id}/confirm 等返回 404）。AI 子模块的可选依赖
  (openai/aiohttp/psutil) 均已在各自模块内做懒加载守卫，启动期直接导入安全。
"""

from __future__ import annotations

from .ai import router as ai_router
from .core.connection_rules import router as connection_rules_router
from .core.data_sources import router as data_sources_router
from .core.regex import router as regex_router
from .core.reporting import router as reporting_router
from .files import router as files_router
from .preview import router as preview_router
from .project import router as project_router
from .projects import router as projects_router
from .validation import router as validation_router

__all__ = [
    "project_router",
    "projects_router",
    "files_router",
    "connection_rules_router",
    "ai_router",
    "preview_router",
    "validation_router",
    "data_sources_router",
    "regex_router",
    "reporting_router",
]
