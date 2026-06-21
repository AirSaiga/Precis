# backend/app/api/models/preview.py
"""
@fileoverview 数据预览响应模型

功能概述:
- 定义数据文件预览相关的 Pydantic 数据模型
- 提供文件预览响应结构，支持 Excel 和 CSV 格式

输入示例:
    预览请求由前端通过文件上传或路径指定触发

输出示例:
    FilePreviewResponse(
        success=True,
        data=[["姓名", "年龄"], ["张三", "25"]],
        file_type="excel",
        file_name="users.xlsx",
        total_rows=100,
        total_cols=5,
        sheets=["Sheet1", "Sheet2"],
        current_sheet="Sheet1"
    )
"""

from pydantic import BaseModel


class FilePreviewResponse(BaseModel):
    """
    文件预览响应模型

    文件预览接口的标准响应格式。

    Attributes:
        success: 操作是否成功
        data: 表格数据（二维数组）
        file_type: 文件类型（excel/csv）
        file_name: 文件名
        total_rows: 总行数
        total_cols: 总列数
        sheets: Excel 工作表列表（CSV 为 null）
        current_sheet: 当前工作表名（CSV 为 null）
        error: 错误信息（成功时为 null）
    """

    success: bool
    data: list[list[str]] | None = None
    file_type: str
    file_name: str
    total_rows: int | None = None
    total_cols: int | None = None
    sheets: list[str] | None = None
    current_sheet: str | None = None
    error: str | None = None
