"""项目管理 API 模型：项目扫描、打开、创建、关闭与当前项目查询的请求/响应定义。"""

from __future__ import annotations

from pydantic import BaseModel


class ProjectInfo(BaseModel):
    """扫描返回的单个项目信息。"""

    name: str
    path: str
    schema_count: int
    constraint_count: int
    last_modified: str


class ScanResponse(BaseModel):
    """项目扫描端点的响应。"""

    work_dir: str
    projects: list[ProjectInfo]


class OpenProjectRequest(BaseModel):
    """打开项目的请求体。"""

    path: str


class OpenProjectResponse(BaseModel):
    """打开项目的响应。"""

    success: bool
    name: str
    path: str


class CreateProjectRequest(BaseModel):
    """创建新项目脚手架的请求体。"""

    path: str
    name: str


class CreateProjectResponse(BaseModel):
    """创建项目的响应。"""

    success: bool
    name: str
    path: str


class CurrentProjectResponse(BaseModel):
    """当前项目查询的响应。"""

    has_current: bool
    path: str | None = None
    name: str | None = None


class CloseProjectResponse(BaseModel):
    """关闭项目的响应。"""

    success: bool
