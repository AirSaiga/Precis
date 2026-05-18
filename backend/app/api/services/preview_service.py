"""
@fileoverview 预览数据处理服务模块

功能概述:
- 提取 DataFrame 到二维列表的公共转换逻辑
- 封装文件类型检测
- 封装临时文件清理
- 提供基于路径和基于内容（上传）的统一预览接口

输入示例:
    data, sheets = preview_from_path("/path/to/file.xlsx", max_rows=100, max_cols=20)
    data, sheets = preview_from_content(content, ".xlsx", max_rows=100, max_cols=20, sheet_name="Sheet2")

输出示例:
    ([["col1", "col2"], ["a", "b"]], ["Sheet1", "Sheet2"])
"""

from __future__ import annotations

import logging
import os
import tempfile
import time

import pandas as pd
from fastapi import HTTPException

from app.shared.services.preview.loader import load_preview_data

logger = logging.getLogger(__name__)


def detect_file_type(file_ext: str) -> str:
    """根据文件扩展名判断文件类型。

    Args:
        file_ext: 文件扩展名（包含点号，如 .xlsx）

    Returns:
        "excel" | "csv"

    Raises:
        HTTPException: 不支持的文件类型
    """
    if file_ext in [".xlsx", ".xls"]:
        return "excel"
    if file_ext == ".csv":
        return "csv"
    raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_ext}")


def df_to_list(df: pd.DataFrame, max_cols: int) -> list[list[str]]:
    """将 DataFrame 转为二维字符串列表，限制列数。

    Args:
        df: pandas DataFrame
        max_cols: 最大列数

    Returns:
        二维字符串列表
    """
    data: list[list[str]] = []
    for _, row in df.iterrows():
        row_data = [str(cell) for cell in row.tolist()[:max_cols]]
        data.append(row_data)
    return data


def cleanup_temp_file(tmp_path: str) -> None:
    """清理临时文件，最多重试 3 次。

    Args:
        tmp_path: 临时文件路径
    """
    if not os.path.exists(tmp_path):
        return
    for _attempt in range(3):
        try:
            os.unlink(tmp_path)
            logger.info(f"[PREVIEW] 已删除临时文件: {tmp_path}")
            break
        except PermissionError:
            time.sleep(0.1)
        except Exception as e:
            logger.info(f"[PREVIEW] 无法删除临时文件: {e}")
            break


def preview_from_path(
    file_path: str,
    max_rows: int,
    max_cols: int,
    sheet_name: str | None = None,
) -> tuple[list[list[str]], str, int, list[str] | None, str | None]:
    """基于文件路径加载预览数据。

    Args:
        file_path: 文件路径
        max_rows: 最大行数
        max_cols: 最大列数
        sheet_name: 指定工作表名称（仅 Excel）

    Returns:
        (data, file_type, total_rows, sheets, current_sheet)

    Raises:
        HTTPException: 文件不存在或读取失败
    """
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"文件未找到: {file_path}")

    file_ext = os.path.splitext(file_path)[1].lower()
    file_type = detect_file_type(file_ext)

    if file_type == "excel":
        try:
            if sheet_name is None:
                excel_file = pd.ExcelFile(file_path, engine="openpyxl")
                sheet_name = excel_file.sheet_names[0] if excel_file.sheet_names else "Sheet1"
                excel_file.close()

            df, sheet_names = load_preview_data(
                file_path=file_path,
                file_type="excel",
                max_rows=max_rows,
                sheet_name=sheet_name,
            )
            data = df_to_list(df, max_cols)
            return data, file_type, len(df), sheet_names, sheet_name
        except ValueError as e:
            if "Worksheet" in str(e):
                raise HTTPException(status_code=404, detail=f"工作表 '{sheet_name}' 不存在") from e
            raise HTTPException(status_code=500, detail=f"读取工作表失败: {str(e)}") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"读取Excel文件失败: {str(e)}") from e

    # CSV
    try:
        df, _ = load_preview_data(file_path=file_path, file_type="csv", max_rows=max_rows)
        data = df_to_list(df, max_cols)
        return data, file_type, len(df), None, None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取CSV文件失败: {str(e)}") from e


def preview_from_content(
    content: bytes,
    file_ext: str,
    max_rows: int,
    max_cols: int,
    sheet_name: str | None = None,
) -> tuple[list[list[str]], str, int, list[str] | None, str | None]:
    """基于文件内容（上传）加载预览数据。

    将内容写入临时文件后解析，处理完成后自动清理。

    Args:
        content: 文件二进制内容
        file_ext: 文件扩展名
        max_rows: 最大行数
        max_cols: 最大列数
        sheet_name: 指定工作表名称（仅 Excel）

    Returns:
        (data, file_type, total_rows, sheets, current_sheet)

    Raises:
        HTTPException: 内容为空或读取失败
    """
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="文件内容为空")

    file_type = detect_file_type(file_ext)
    tmp_path = ""

    try:
        with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        if file_type == "excel":
            try:
                excel_file = pd.ExcelFile(tmp_path, engine="openpyxl")
                actual_sheet = sheet_name or (excel_file.sheet_names[0] if excel_file.sheet_names else "Sheet1")
                excel_file.close()

                df, sheet_names = load_preview_data(
                    file_path=tmp_path,
                    file_type="excel",
                    max_rows=max_rows,
                    sheet_name=actual_sheet,
                )
                data = df_to_list(df, max_cols)
                return data, file_type, len(df), sheet_names, actual_sheet
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"读取Excel文件失败: {str(e)}") from e
            finally:
                import gc

                gc.collect()

        # CSV
        try:
            df, _ = load_preview_data(file_path=tmp_path, file_type="csv", max_rows=max_rows)
            data = df_to_list(df, max_cols)
            return data, file_type, len(df), None, None
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"读取CSV文件失败: {str(e)}") from e

    finally:
        if tmp_path:
            cleanup_temp_file(tmp_path)
