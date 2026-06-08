"""
@fileoverview Project API Router 聚合模块

功能概述:
- 聚合 project 子模块的所有 FastAPI router
- 统一设置 prefix="/project" 和 tags=["Project"]

架构设计:
- 各子模块 router 通过 include_router 合并到主 router
- 子模块本身使用空 prefix，由主 router 统一添加前缀
"""

from fastapi import APIRouter

from . import (
    constraint,
    full_config,
    manifest,
    pattern,
    regex,
    schema,
    settings,
    template,
    validation,
    view,
    workspaces,
)

router = APIRouter(
    prefix="/api/v1/project",
    tags=["Project"],
)

router.include_router(view.router)
router.include_router(workspaces.router)
router.include_router(manifest.router)
router.include_router(schema.router)
router.include_router(constraint.router)
router.include_router(regex.router)
router.include_router(pattern.router)
router.include_router(template.router)
router.include_router(full_config.router)
router.include_router(settings.router)
router.include_router(validation.router)
