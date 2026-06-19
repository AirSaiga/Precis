from __future__ import annotations

from pydantic import BaseModel


class ProjectInfo(BaseModel):
    """Single project info returned by scan."""

    name: str
    path: str
    schema_count: int
    constraint_count: int
    last_modified: str


class ScanResponse(BaseModel):
    """Response from project scan endpoint."""

    work_dir: str
    projects: list[ProjectInfo]


class OpenProjectRequest(BaseModel):
    """Request body for opening a project."""

    path: str


class OpenProjectResponse(BaseModel):
    """Response from opening a project."""

    success: bool
    name: str
    path: str


class CurrentProjectResponse(BaseModel):
    """Response for current project query."""

    has_current: bool
    path: str | None = None
    name: str | None = None


class CloseProjectResponse(BaseModel):
    """Response from closing a project."""

    success: bool
