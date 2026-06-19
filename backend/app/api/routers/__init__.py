"""
@fileoverview API 路由聚合入口模块

功能概述:
- 聚合并导出所有子模块的路由器实例
- 统一暴露项目、AI、预览、校验、工作空间等路由
- AI 路由采用懒加载代理，避免在主应用导入时立即触发 heavy/optional 依赖
"""

from __future__ import annotations

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


class _LazyAIRouter:
    """
    AI 路由懒加载代理。

    `app.api.routers.ai` 模块可能依赖可选的 AI 包（如 openai）。
    通过此代理，仅在 FastAPI `include_router` 真正访问路由属性
    （如 `.routes`、`.prefix`、`.tags`）时才触发实际导入，
    避免在普通启动路径中无条件加载 AI 模块。
    """

    def __init__(self) -> None:
        self._router: object | None = None

    def _load(self) -> object:
        if self._router is None:
            from .ai import router as _router

            self._router = _router
        return self._router

    def __getattr__(self, name: str) -> object:
        return getattr(self._load(), name)


ai_router = _LazyAIRouter()
