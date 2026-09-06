# SPDX-License-Identifier: Apache-2.0
#
# Copyright 2026 Precis Team
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""文件操作 API 模型：读/写文件、目录扫描、mkdir、存在性检查的请求/响应定义。"""

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
