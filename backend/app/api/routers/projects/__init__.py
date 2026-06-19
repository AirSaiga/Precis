from fastapi import APIRouter

from . import scan, open

router = APIRouter(prefix="/api/latest/projects", tags=["Projects"])
router.include_router(scan.router)
router.include_router(open.router)
