"""
@fileoverview API 路由聚合入口模块

功能概述:
- 聚合并导出所有子模块的路由器实例
- 统一暴露项目、AI、预览、校验、工作空间等路由
"""

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


def __getattr__(name: str):
    if name == "ai_router":
        from .ai import router as ai_router

        return ai_router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
