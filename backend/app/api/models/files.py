from __future__ import annotations

from pydantic import BaseModel


class ReadFileRequest(BaseModel):
    path: str


class ReadFileResponse(BaseModel):
    content: str
    encoding: str = "utf-8"


class WriteFileRequest(BaseModel):
    path: str
    content: str


class WriteFileResponse(BaseModel):
    success: bool


class FileExistsResponse(BaseModel):
    exists: bool


class ScanDirectoryRequest(BaseModel):
    path: str
    extensions: list[str] | None = None


class ScanDirectoryResponse(BaseModel):
    entries: list[DirectoryEntry]


class DirectoryEntry(BaseModel):
    name: str
    path: str
    is_dir: bool


class MkdirRequest(BaseModel):
    path: str


class MkdirResponse(BaseModel):
    success: bool
