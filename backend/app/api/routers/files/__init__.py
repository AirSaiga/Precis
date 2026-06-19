from fastapi import APIRouter

from . import ops, transfer

router = APIRouter(prefix="/api/latest/files", tags=["Files"])
router.include_router(ops.router)
router.include_router(transfer.router)
