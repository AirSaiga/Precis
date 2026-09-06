"""文件操作路由聚合：/api/latest/files 下的读写操作与上传传输子路由。"""

from fastapi import APIRouter

from . import ops, transfer

router = APIRouter(prefix="/api/latest/files", tags=["Files"])
router.include_router(ops.router)
router.include_router(transfer.router)
