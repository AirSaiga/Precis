from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from app.api.models.files import (
    ReadFileRequest,
    ReadFileResponse,
    WriteFileRequest,
    WriteFileResponse,
    FileExistsResponse,
    ScanDirectoryRequest,
    ScanDirectoryResponse,
    DirectoryEntry,
    MkdirRequest,
    MkdirResponse,
)

router = APIRouter(prefix="", tags=["Files-Ops"])


@router.post(
    "/read",
    response_model=ReadFileResponse,
    summary="读取文件内容",
)
def read_file(request: ReadFileRequest) -> ReadFileResponse:
    """读取指定路径的文件内容。"""
    path = os.path.abspath(os.path.normpath(request.path))
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
    """写入内容到指定文件（自动创建父目录）。"""
    path = os.path.abspath(os.path.normpath(request.path))
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
def check_file_exists(path: str) -> FileExistsResponse:
    """检查指定路径的文件是否存在。"""
    resolved = os.path.abspath(os.path.normpath(path))
    return FileExistsResponse(exists=os.path.isfile(resolved) or os.path.isdir(resolved))


@router.post(
    "/scan",
    response_model=ScanDirectoryResponse,
    summary="扫描目录内容",
)
def scan_directory(request: ScanDirectoryRequest) -> ScanDirectoryResponse:
    """扫描指定目录，返回文件和子目录列表。"""
    path = os.path.abspath(os.path.normpath(request.path))
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"目录不存在: {path}")
    try:
        entries: list[DirectoryEntry] = []
        for entry in os.scandir(path):
            name = entry.name
            if request.extensions and not entry.is_dir():
                ext = os.path.splitext(name)[1].lower()
                if ext not in request.extensions:
                    continue
            entries.append(DirectoryEntry(
                name=name,
                path=os.path.abspath(entry.path),
                is_dir=entry.is_dir(),
            ))
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
    """递归创建目录。"""
    path = os.path.abspath(os.path.normpath(request.path))
    try:
        os.makedirs(path, exist_ok=True)
        return MkdirResponse(success=True)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限创建目录")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"创建目录失败: {e}")
