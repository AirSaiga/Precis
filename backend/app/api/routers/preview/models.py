"""
@fileoverview 文件预览请求/响应模型定义

功能概述:
- 定义文件预览相关的 Pydantic 数据模型
- 包括路径预览、内容预览、工作表切换等请求和响应结构
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class FilePreviewRequest(BaseModel):
    """文件预览请求（基于上传内容模式）"""

    file_path: str = Field(..., description="文件原始名称（仅用于展示，不参与 IO）")
    max_rows: int = Field(default=65535, description="最大返回行数")
    max_cols: int = Field(default=65535, description="最大返回列数")


class FilePreviewResponse(BaseModel):
    """文件预览响应"""

    success: bool = Field(..., description="是否成功解析")
    data: list[list[str]] | None = Field(default=None, description="表格化预览数据")
    file_type: str = Field(..., description="文件类型标识，如 xlsx/csv/json")
    file_name: str = Field(..., description="原始文件名")
    total_rows: int | None = Field(default=None, description="文件总行数")
    total_cols: int | None = Field(default=None, description="文件总列数")
    sheets: list[str] | None = Field(default=None, description="Excel 工作表列表")
    current_sheet: str | None = Field(default=None, description="当前预览的工作表名")
    error: str | None = Field(default=None, description="错误信息")
    # JSON 原始数据（用于树状显示）
    raw_data: list[Any] | None = Field(default=None, description="JSON 原始数据（用于树状显示）")
    # JSON 类型推断（字段名 → 推断类型）
    type_inference: dict[str, str] | None = Field(default=None, description="JSON 字段类型推断结果")
    # JSON 结构统计
    field_count: int | None = Field(default=None, description="JSON 顶层字段数量")
    nest_depth: int | None = Field(default=None, description="JSON 嵌套深度")


class SheetSwitchRequest(BaseModel):
    """Excel 工作表切换请求"""

    file_path: str = Field(..., description="文件路径或原始名称")
    sheet_name: str = Field(..., description="目标工作表名")
    max_rows: int = Field(default=100, description="最大返回行数")
    max_cols: int = Field(default=50, description="最大返回列数")


class FilePathPreviewRequest(BaseModel):
    """基于文件路径的预览请求"""

    file_path: str = Field(..., description="文件绝对路径")
    max_rows: int = Field(default=65535, description="最大返回行数")
    max_cols: int = Field(default=65535, description="最大返回列数")
    sheet_name: str | None = Field(default=None, description="Excel 工作表名")
    # JSON 特有参数
    json_path: str | None = Field(default=None, description="JSONPath 提取路径，如 $.data.items")
    json_format: str | None = Field(
        default=None, description="JSON 格式：auto / array / lines / object（前端直接透传）"
    )
    record_path: str | None = Field(default=None, description="Record path，用于 pd.json_normalize")
