from fastapi import APIRouter

from . import create, open, scan

router = APIRouter(prefix="/api/latest/projects", tags=["Projects"])
router.include_router(scan.router)
router.include_router(open.router)
router.include_router(create.router)
