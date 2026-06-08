"""
@fileoverview 文件内容预览路由模块

功能概述:
- 提供基于文件路径和文件上传的数据预览接口
- 支持 Excel（.xlsx/.xls）和 CSV 文件的内容解析与预览
- 支持工作表切换预览
- 使用临时文件存储上传内容，处理完成后自动清理
- 限制返回的最大行数和列数，防止内存溢出

架构设计:
- 基于 FastAPI APIRouter 组织路由
- 具体预览逻辑委托给 preview_service.py
"""

from __future__ import annotations

import logging
import os

from fastapi import File, Form, HTTPException, UploadFile

from app.api.routers.preview.models import FilePreviewRequest, FilePreviewResponse, SheetSwitchRequest
from app.api.services.preview_service import (
    preview_from_content,
    preview_from_path,
)
from app.shared.services.preview.path import validate_file_access

from .router import router

logger = logging.getLogger(__name__)


@router.post(
    "/file",
    response_model=FilePreviewResponse,
    summary="基于文件路径预览文件内容",
    responses={
        500: {"description": "预览文件时发生错误"},
    },
)
def preview_file(request: FilePreviewRequest):
    """基于文件路径预览文件内容

    根据请求中的文件路径读取 Excel 或 CSV 文件，
    返回指定行数和列数的预览数据。
    """
    logger.info("=" * 50)
    logger.info(f"[PREVIEW] 收到文件预览请求: {request.file_path}")
    logger.info(f"[PREVIEW] max_rows: {request.max_rows}, max_cols: {request.max_cols}")
    logger.info("=" * 50)

    try:
        data, file_type, total_rows, sheets, current_sheet = preview_from_path(
            request.file_path,
            request.max_rows,
            request.max_cols,
        )
        return FilePreviewResponse(
            success=True,
            data=data,
            file_type=file_type,
            file_name=os.path.basename(request.file_path),
            total_rows=total_rows,
            total_cols=len(data[0]) if data else 0,
            sheets=sheets,
            current_sheet=current_sheet,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PREVIEW] 未知错误: {e}")
        return FilePreviewResponse(
            success=False,
            data=None,
            file_type="unknown",
            file_name="",
            error=f"预览文件时发生错误: {e}",
        )


@router.post(
    "/file/content",
    response_model=FilePreviewResponse,
    summary="基于文件上传预览文件内容",
    responses={
        500: {"description": "预览文件时发生错误"},
    },
)
async def preview_file_content(
    file: UploadFile = File(...),
    max_rows: int = Form(65535),
    max_cols: int = Form(65535),
):
    """基于文件上传预览文件内容

    接收前端上传的文件流，保存到临时文件后解析预览。
    """
    logger.info("=" * 50)
    logger.info(f"[PREVIEW] 收到文件内容预览请求: {file.filename}")
    logger.info(f"[PREVIEW] max_rows: {max_rows}, max_cols: {max_cols}")
    logger.info("=" * 50)

    try:
        file_name = file.filename or "unknown"
        file_ext = os.path.splitext(file_name)[1].lower()
        content = await file.read()

        data, file_type, total_rows, sheets, current_sheet = preview_from_content(content, file_ext, max_rows, max_cols)
        return FilePreviewResponse(
            success=True,
            data=data,
            file_type=file_type,
            file_name=file_name,
            total_rows=total_rows,
            total_cols=len(data[0]) if data else 0,
            sheets=sheets,
            current_sheet=current_sheet,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[PREVIEW] 未知错误: {e}")
        return FilePreviewResponse(
            success=False,
            data=None,
            file_type="unknown",
            file_name=file.filename or "",
            error=f"预览文件时发生错误: {e}",
        )


@router.post(
    "/switch-sheet",
    response_model=FilePreviewResponse,
    summary="切换 Excel 工作表预览",
    responses={
        500: {"description": "切换工作表时发生错误"},
    },
)
def switch_sheet(request: SheetSwitchRequest):
    """切换 Excel 工作表预览"""
    file_path = request.file_path

    validate_file_access(file_path)

    try:
        data, file_type, total_rows, sheets, current_sheet = preview_from_path(
            file_path,
            request.max_rows,
            request.max_cols,
            sheet_name=request.sheet_name,
        )
        return FilePreviewResponse(
            success=True,
            data=data,
            file_type=file_type,
            file_name=os.path.basename(request.file_path),
            total_rows=total_rows,
            total_cols=len(data[0]) if data else 0,
            sheets=sheets,
            current_sheet=current_sheet,
        )
    except HTTPException:
        raise
    except Exception as e:
        return FilePreviewResponse(
            success=False,
            data=None,
            file_type="excel",
            file_name="",
            error=f"切换工作表时发生错误: {e}",
        )


@router.post(
    "/switch-sheet/content",
    response_model=FilePreviewResponse,
    summary="基于文件上传切换 Excel 工作表预览",
    responses={
        500: {"description": "切换工作表时发生错误"},
    },
)
async def switch_sheet_content(
    file: UploadFile = File(...),
    sheet_name: str = Form(...),
    max_rows: int = Form(65535),
    max_cols: int = Form(65535),
):
    """基于文件上传切换 Excel 工作表预览"""
    try:
        file_name = file.filename or "unknown"
        file_ext = os.path.splitext(file_name)[1].lower()
        content = await file.read()

        data, file_type, total_rows, sheets, current_sheet = preview_from_content(
            content, file_ext, max_rows, max_cols, sheet_name=sheet_name
        )
        return FilePreviewResponse(
            success=True,
            data=data,
            file_type=file_type,
            file_name=file_name,
            total_rows=total_rows,
            total_cols=len(data[0]) if data else 0,
            sheets=sheets,
            current_sheet=current_sheet,
        )
    except HTTPException:
        raise
    except Exception as e:
        return FilePreviewResponse(
            success=False,
            data=None,
            file_type="excel",
            file_name=file.filename or "",
            error=f"切换工作表时发生错误: {e}",
        )
