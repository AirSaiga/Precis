from __future__ import annotations

import os
import uuid
import tempfile

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

router = APIRouter(prefix="", tags=["Files-Transfer"])

# 临时文件存储目录
TEMP_DIR = os.path.join(tempfile.gettempdir(), "precis-web-uploads")


@router.post(
    "/upload",
    summary="上传文件到临时目录",
)
async def upload_file(file: UploadFile = File(...)) -> dict:
    """上传文件到服务器临时目录，返回临时路径。"""
    os.makedirs(TEMP_DIR, exist_ok=True)
    file_id = str(uuid.uuid4())
    # 保留原始扩展名
    ext = os.path.splitext(file.filename or "file")[1] if file.filename else ""
    dest_path = os.path.join(TEMP_DIR, f"{file_id}{ext}")
    try:
        content = await file.read()
        with open(dest_path, "wb") as f:
            f.write(content)
        return {
            "success": True,
            "temp_path": dest_path,
            "original_name": file.filename or "unknown",
            "size": len(content),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件上传失败: {e}")


@router.get(
    "/download",
    summary="下载文件",
)
def download_file(path: str) -> FileResponse:
    """下载指定路径的文件。"""
    resolved = os.path.abspath(os.path.normpath(path))
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail=f"文件不存在: {resolved}")
    filename = os.path.basename(resolved)
    return FileResponse(resolved, filename=filename, media_type="application/octet-stream")


@router.delete(
    "/temp/{file_id:path}",
    summary="清理临时文件",
)
def delete_temp_file(file_id: str) -> dict:
    """删除临时目录中的文件。"""
    file_path = os.path.join(TEMP_DIR, file_id)
    if os.path.isfile(file_path):
        os.unlink(file_path)
        return {"success": True}
    # 尝试匹配前缀（file_id 可能不含扩展名）
    for f in os.listdir(TEMP_DIR):
        if f.startswith(file_id):
            os.unlink(os.path.join(TEMP_DIR, f))
            return {"success": True}
    raise HTTPException(status_code=404, detail="临时文件未找到")
