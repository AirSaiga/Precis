from fastapi import APIRouter

from . import ops

router = APIRouter(prefix="/api/latest/files", tags=["Files"])
router.include_router(ops.router)
