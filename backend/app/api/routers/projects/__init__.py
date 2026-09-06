"""项目管理路由聚合：/api/latest/projects 下的扫描、打开、创建子路由。"""

from fastapi import APIRouter

from . import create, open, scan

router = APIRouter(prefix="/api/latest/projects", tags=["Projects"])
router.include_router(scan.router)
router.include_router(open.router)
router.include_router(create.router)
