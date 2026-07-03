from __future__ import annotations

import os
import tempfile
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.shared.services.preview.path_validation import assert_path_within_root

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
    summary="下载临时文件",
)
def download_file(path: str) -> FileResponse:
    """
    下载指定的临时上传文件。

    安全约束：仅允许下载 TEMP_DIR 内的文件，防止任意文件下载。
    """
    resolved = assert_path_within_root(path, TEMP_DIR, must_exist=True)
    filename = os.path.basename(resolved)
    return FileResponse(resolved, filename=filename, media_type="application/octet-stream")


@router.delete(
    "/temp/{file_id:path}",
    summary="清理临时文件",
)
def delete_temp_file(file_id: str) -> dict:
    """
    删除临时目录中的文件。

    安全约束：file_id 经反穿越校验后限定在 TEMP_DIR 内，防止 `..` 逃逸。
    """
    # file_id 来自 path 参数，可能含 `..`；先组装再用 assert_path_within_root 限定到 TEMP_DIR
    candidate = os.path.join(TEMP_DIR, file_id)
    try:
        resolved = assert_path_within_root(candidate, TEMP_DIR, must_exist=False)
    except HTTPException:
        raise
    # 精确匹配
    if os.path.isfile(resolved):
        os.unlink(resolved)
        return {"success": True}
    # 尝试匹配前缀（file_id 可能不含扩展名），前缀比对基于 basename 防止逃逸
    target_prefix = os.path.basename(resolved)
    for f in os.listdir(TEMP_DIR):
        if f.startswith(target_prefix):
            os.unlink(os.path.join(TEMP_DIR, f))
            return {"success": True}
    raise HTTPException(status_code=404, detail="临时文件未找到")
