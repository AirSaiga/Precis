from __future__ import annotations

from pydantic import BaseModel, Field


class ReadFileRequest(BaseModel):
    """读取文件请求。

    B-sec1 安全约束: path 必须位于 root 指定的项目根目录下，由后端 assert_path_within_root 强制校验。
    """

    path: str
    root: str = Field(..., description="项目根目录绝对路径，作为白名单根；path 必须落于此目录内")


class ReadFileResponse(BaseModel):
    content: str
    encoding: str = "utf-8"


class WriteFileRequest(BaseModel):
    """写入文件请求。

    B-sec1 安全约束: path 必须位于 root 指定的项目根目录下。
    """

    path: str
    content: str
    root: str = Field(..., description="项目根目录绝对路径，作为白名单根；path 必须落于此目录内")


class WriteFileResponse(BaseModel):
    success: bool


class FileExistsRequest(BaseModel):
    """检查存在性请求。

    B-sec1 安全约束: path 必须位于 root 指定的项目根目录下。
    """

    path: str
    root: str = Field(..., description="项目根目录绝对路径，作为白名单根；path 必须落于此目录内")


class FileExistsResponse(BaseModel):
    exists: bool


class ScanDirectoryRequest(BaseModel):
    """扫描目录请求。

    B-sec1 安全约束: path 必须位于 root 指定的项目根目录下。
    """

    path: str
    extensions: list[str] | None = None
    root: str = Field(..., description="项目根目录绝对路径，作为白名单根；path 必须落于此目录内")


class ScanDirectoryResponse(BaseModel):
    entries: list[DirectoryEntry]


class DirectoryEntry(BaseModel):
    name: str
    path: str
    is_dir: bool


class MkdirRequest(BaseModel):
    """创建目录请求。

    B-sec1 安全约束: path 必须位于 root 指定的项目根目录下。
    """

    path: str
    root: str = Field(..., description="项目根目录绝对路径，作为白名单根；path 必须落于此目录内")


class MkdirResponse(BaseModel):
    success: bool
