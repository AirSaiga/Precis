"""
@fileoverview 文件预览请求/响应模型定义

功能概述:
- 定义文件预览相关的 Pydantic 数据模型
- 包括路径预览、内容预览、工作表切换等请求和响应结构
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class FilePreviewRequest(BaseModel):
    file_path: str
    max_rows: int = 65535
    max_cols: int = 65535


class FilePreviewResponse(BaseModel):
    success: bool
    data: list[list[str]] | None = None
    file_type: str
    file_name: str
    total_rows: int | None = None
    total_cols: int | None = None
    sheets: list[str] | None = None
    current_sheet: str | None = None
    error: str | None = None
    # JSON 原始数据（用于树状显示）
    raw_data: list[Any] | None = None
    # JSON 类型推断（字段名 → 推断类型）
    type_inference: dict[str, str] | None = None
    # JSON 结构统计
    field_count: int | None = None
    nest_depth: int | None = None


class SheetSwitchRequest(BaseModel):
    file_path: str
    sheet_name: str
    max_rows: int = 100
    max_cols: int = 50


class FilePathPreviewRequest(BaseModel):
    file_path: str
    max_rows: int = 65535
    max_cols: int = 65535
    sheet_name: str | None = None
    # JSON 特有参数
    json_path: str | None = None  # JSONPath 提取路径，如 "$.data.items"
    json_format: str | None = None  # JSON 格式：auto / array / lines / object（前端直接透传，无需映射）
    record_path: str | None = None  # Record path，用于 pd.json_normalize
