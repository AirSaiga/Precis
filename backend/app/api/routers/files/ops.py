from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Query

from app.api.models.files import (
    DirectoryEntry,
    FileExistsResponse,
    MkdirRequest,
    MkdirResponse,
    ReadFileRequest,
    ReadFileResponse,
    ScanDirectoryRequest,
    ScanDirectoryResponse,
    WriteFileRequest,
    WriteFileResponse,
)
from app.shared.services.preview.path_validation import assert_path_within_root

router = APIRouter(prefix="", tags=["Files-Ops"])


@router.post(
    "/read",
    response_model=ReadFileResponse,
    summary="读取文件内容",
)
def read_file(request: ReadFileRequest) -> ReadFileResponse:
    """读取指定路径的文件内容。

    B-sec1 安全约束: path 必须位于 root（白名单根）下，由 assert_path_within_root 强制校验，
    拒绝项目外任意文件读取。root 通常为当前项目配置目录（X-Project-Config-Path）。
    """
    path = assert_path_within_root(request.path, request.root, must_exist=False)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
        return ReadFileResponse(content=content)
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="文件编码不是 UTF-8，暂时不支持")
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限读取文件")


@router.post(
    "/write",
    response_model=WriteFileResponse,
    summary="写入文件内容",
)
def write_file(request: WriteFileRequest) -> WriteFileResponse:
    """写入内容到指定文件（自动创建父目录）。

    B-sec1 安全约束: path 必须位于 root（白名单根）下，由 assert_path_within_root 强制校验，
    拒绝项目外任意文件写入。
    """
    # 写入场景允许目标不存在，故 must_exist=False
    path = assert_path_within_root(request.path, request.root, must_exist=False)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(request.content)
        return WriteFileResponse(success=True)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限写入文件")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"写入文件失败: {e}")


@router.get(
    "/exists",
    response_model=FileExistsResponse,
    summary="检查文件是否存在",
)
def check_file_exists(
    path: str,
    root: str = Query(..., description="项目根目录绝对路径，作为白名单根；path 必须落于此目录内"),
) -> FileExistsResponse:
    """检查指定路径的文件是否存在。

    B-sec1 安全约束: path 必须位于 root（白名单根）下。GET 端点通过 query 参数传 root。
    """
    resolved = assert_path_within_root(path, root, must_exist=False)
    return FileExistsResponse(exists=os.path.isfile(resolved) or os.path.isdir(resolved))


@router.post(
    "/scan",
    response_model=ScanDirectoryResponse,
    summary="扫描目录内容",
)
def scan_directory(request: ScanDirectoryRequest) -> ScanDirectoryResponse:
    """扫描指定目录，返回文件和子目录列表。

    B-sec1 安全约束: path 必须位于 root（白名单根）下。
    """
    path = assert_path_within_root(request.path, request.root, must_exist=False)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"目录不存在: {path}")
    try:
        entries: list[DirectoryEntry] = []
        for entry in os.scandir(path):
            name = entry.name
            if request.extensions and not entry.is_dir():
                ext = os.path.splitext(name)[1].lower()
                # B16 修复：扩展名归一化，允许调用方传 ['csv'] 或 ['.csv'] 均可命中
                # 过去要求带前导点，传 ['csv'] 会因 '.csv' not in ['csv'] 被全部过滤
                normalized_exts = {e if e.startswith(".") else f".{e}" for e in request.extensions}
                normalized_exts_lower = {e.lower() for e in normalized_exts}
                if ext not in normalized_exts_lower:
                    continue
            entries.append(
                DirectoryEntry(
                    name=name,
                    path=os.path.abspath(entry.path),
                    is_dir=entry.is_dir(),
                )
            )
        entries.sort(key=lambda e: (not e.is_dir, e.name.lower()))
        return ScanDirectoryResponse(entries=entries)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问目录")


@router.post(
    "/mkdir",
    response_model=MkdirResponse,
    summary="创建目录（含父目录）",
)
def make_directory(request: MkdirRequest) -> MkdirResponse:
    """递归创建目录。

    B-sec1 安全约束: path 必须位于 root（白名单根）下。
    """
    path = assert_path_within_root(request.path, request.root, must_exist=False)
    try:
        os.makedirs(path, exist_ok=True)
        return MkdirResponse(success=True)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限创建目录")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"创建目录失败: {e}")
