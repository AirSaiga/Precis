"""
@fileoverview 文件路径预览路由模块（基于文件路径访问）

功能概述:
- 提供基于文件路径的数据预览接口（非上传模式）
- 支持 Excel（.xlsx/.xls）、CSV 和 JSON 文件格式
- JSON 文件支持 JSONPath 提取、多种格式解析和 record_path 规范化
- 集成路径安全校验，限制只允许访问允许的目录范围
- 支持工作表切换预览（Excel）

架构设计:
- 基于 FastAPI APIRouter 组织路由，挂载到 /preview 前缀下
- 使用 pandas 读取 Excel/CSV，使用策略模式解析 JSON
- 依赖 JSONPathExtractor 和 parser 策略实现灵活的 JSON 数据处理
- 通过 validate_file_access 实现统一的路径安全控制
"""

from __future__ import annotations

import logging
import os
from typing import Any

import pandas as pd
from fastapi import HTTPException

from app.api.routers.preview.models import FilePathPreviewRequest, FilePreviewResponse, SheetSwitchRequest
from app.shared.core.data_source.loaders.extractor import JSONPathExtractor
from app.shared.core.data_source.loaders.strategies import get_parser
from app.shared.services.preview.loader import load_preview_data
from app.shared.services.preview.path import validate_file_access

from .router import router

logger = logging.getLogger(__name__)


def _infer_json_type(value: Any) -> str:
    """推断 JSON 值的类型（用于前端类型标记展示）。"""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) or isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "string"


@router.post("/file/path", response_model=FilePreviewResponse)
def preview_file_by_path(request: FilePathPreviewRequest):
    logger.info("=" * 50)
    logger.info(f"[PREVIEW] 收到路径预览请求: {request.file_path}")
    logger.info(f"[PREVIEW] max_rows: {request.max_rows}, max_cols: {request.max_cols}")
    if request.sheet_name:
        logger.info(f"[PREVIEW] 指定工作表: {request.sheet_name}")
    logger.info("=" * 50)

    try:
        file_path = request.file_path
        max_rows = request.max_rows
        max_cols = request.max_cols
        sheet_name = request.sheet_name

        validate_file_access(file_path)

        file_ext = os.path.splitext(file_path)[1].lower()
        file_name = os.path.basename(file_path)

        if file_ext in [".xlsx", ".xls"]:
            file_type = "excel"
        elif file_ext == ".csv":
            file_type = "csv"
        elif file_ext == ".json":
            file_type = "json"
        else:
            raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_ext}")

        if file_type == "excel":
            try:
                excel_file = pd.ExcelFile(file_path, engine="openpyxl")
                sheet_names = excel_file.sheet_names

                if sheet_name:
                    if sheet_name in sheet_names:
                        current_sheet = sheet_name
                    else:
                        raise HTTPException(
                            status_code=404,
                            detail=f"工作表 '{sheet_name}' 不存在，可用工作表: {sheet_names}",
                        )
                else:
                    current_sheet = sheet_names[0] if sheet_names else "Sheet1"

                logger.info(f"[PREVIEW] 工作表列表: {sheet_names}, 当前工作表: {current_sheet}")

                df, sheet_names = load_preview_data(
                    file_path=file_path,
                    file_type="excel",
                    max_rows=max_rows,
                    sheet_name=current_sheet,
                )

                data = []
                for _, row in df.iterrows():
                    row_data = [str(cell) for cell in row.tolist()[:max_cols]]
                    data.append(row_data)

                logger.info(
                    f"[PREVIEW] Excel 文件读取成功: {file_name}, 行数: {len(df)}, 列数: {len(data[0]) if data else 0}"
                )

                return FilePreviewResponse(
                    success=True,
                    data=data,
                    file_type=file_type,
                    file_name=file_name,
                    total_rows=len(df),
                    total_cols=len(data[0]) if data else 0,
                    sheets=sheet_names,
                    current_sheet=current_sheet,
                )

            except Exception as e:
                logger.info(f"[PREVIEW] 读取 Excel 文件失败: {e}")
                import traceback

                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"读取Excel文件失败: {str(e)}") from e

        if file_type == "csv":
            try:
                df, _ = load_preview_data(
                    file_path=file_path,
                    file_type="csv",
                    max_rows=max_rows,
                )

                data = []
                for _, row in df.iterrows():
                    row_data = [str(cell) for cell in row.tolist()[:max_cols]]
                    data.append(row_data)

                logger.info(
                    f"[PREVIEW] CSV 文件读取成功: {file_name}, 行数: {len(df)}, 列数: {len(data[0]) if data else 0}"
                )

                return FilePreviewResponse(
                    success=True,
                    data=data,
                    file_type=file_type,
                    file_name=file_name,
                    total_rows=len(df),
                    total_cols=len(data[0]) if data else 0,
                    sheets=None,
                    current_sheet=None,
                )

            except Exception as e:
                logger.info(f"[PREVIEW] 读取 CSV 文件失败: {e}")
                import traceback

                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"读取CSV文件失败: {str(e)}") from e

        if file_type == "json":
            try:
                import json as json_module

                with open(file_path, encoding="utf-8") as f:
                    content = f.read()

                # 1. 如果指定了 json_path，先使用 JSONPath 提取数据
                if request.json_path:
                    try:
                        raw_data = json_module.loads(content)
                        extractor = JSONPathExtractor()
                        extracted = extractor.extract(raw_data, request.json_path)
                        if not extracted:
                            raise HTTPException(
                                status_code=400, detail=f"JSONPath '{request.json_path}' 未匹配到任何数据"
                            )
                        # 提取后的数据作为 records 使用
                        records = extracted if isinstance(extracted, list) else [extracted]
                    except json_module.JSONDecodeError as e:
                        raise HTTPException(status_code=400, detail=f"JSON 解析失败: {e.msg}") from e
                else:
                    # 2. 根据 json_format 选择合适的 parser（前端已统一为后端格式，直接透传）
                    format_type = request.json_format or "auto"

                    try:
                        parser = get_parser(format_type)
                    except ValueError as e:
                        raise HTTPException(status_code=400, detail=str(e)) from e

                    records = parser.parse(content)

                # 3. 应用 record_path 参数（如果指定）
                if request.record_path and records:
                    try:
                        records = pd.json_normalize(records, record_path=request.record_path).to_dict("records")
                    except (KeyError, TypeError) as e:
                        raise HTTPException(
                            status_code=400, detail=f"record_path '{request.record_path}' 无效: {str(e)}"
                        ) from e

                # 限制返回的记录数
                limited_records = records[:max_rows] if records else []

                # JSON 类型推断和结构统计
                type_inference: dict[str, str] | None = None
                field_count: int | None = None
                nest_depth: int | None = None

                if records and isinstance(records, list) and len(records) > 0:
                    first_record = records[0]
                    if isinstance(first_record, dict):
                        # 推断每个字段的类型（遍历所有记录取最精确类型）
                        type_inference = {}
                        for key in first_record.keys():
                            types_found: set[str] = set()
                            for record in records:
                                if isinstance(record, dict) and key in record:
                                    val = record[key]
                                    types_found.add(_infer_json_type(val))
                            # 如果只有一种类型，直接使用；多种类型时优先 object > array > string
                            if len(types_found) == 1:
                                type_inference[key] = types_found.pop()
                            elif "object" in types_found:
                                type_inference[key] = "object"
                            elif "array" in types_found:
                                type_inference[key] = "array"
                            else:
                                type_inference[key] = "string"

                        field_count = len(first_record)

                        # 计算最大嵌套深度
                        def _calc_depth(obj: Any, depth: int = 0) -> int:
                            if not isinstance(obj, (dict, list)):
                                return depth
                            if isinstance(obj, list):
                                if not obj:
                                    return depth
                                return max(_calc_depth(item, depth + 1) for item in obj)
                            # dict
                            values = list(obj.values())
                            if not values:
                                return depth
                            return max(_calc_depth(v, depth + 1) for v in values)

                        nest_depth = _calc_depth(first_record, 0)

                logger.info(f"[PREVIEW] JSON 文件读取成功: {file_name}, 记录数: {len(limited_records)}")
                if request.json_path:
                    logger.info(f"[PREVIEW] 使用 JSONPath: {request.json_path}")
                if request.json_format:
                    logger.info(f"[PREVIEW] 使用格式: {request.json_format}")
                if request.record_path:
                    logger.info(f"[PREVIEW] 使用 record_path: {request.record_path}")

                return FilePreviewResponse(
                    success=True,
                    data=None,  # JSON 不使用表格数据
                    raw_data=limited_records,  # 返回原始 JSON 数据用于树状显示
                    file_type=file_type,
                    file_name=file_name,
                    total_rows=len(records) if records else 0,
                    total_cols=None,  # JSON 没有固定列数概念
                    sheets=None,
                    current_sheet=None,
                    type_inference=type_inference,
                    field_count=field_count,
                    nest_depth=nest_depth,
                )

            except HTTPException:
                raise
            except Exception as e:
                logger.info(f"[PREVIEW] 读取 JSON 文件失败: {e}")
                import traceback

                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"读取JSON文件失败: {str(e)}") from e

        raise HTTPException(status_code=400, detail=f"不支持的文件类型: {file_type}")

    except HTTPException:
        raise
    except Exception as e:
        logger.info(f"[PREVIEW] 未知错误: {str(e)}")
        import traceback

        traceback.print_exc()
        return FilePreviewResponse(
            success=False,
            data=None,
            file_type="unknown",
            file_name="",
            error=f"预览文件时发生错误: {str(e)}",
        )


@router.post("/switch-sheet/path", response_model=FilePreviewResponse)
def switch_sheet_by_path(request: SheetSwitchRequest):
    try:
        file_path = request.file_path
        sheet_name = request.sheet_name
        max_rows = request.max_rows
        max_cols = request.max_cols

        validate_file_access(file_path)

        file_name = os.path.basename(file_path)
        file_ext = os.path.splitext(file_path)[1].lower()

        if file_ext not in [".xlsx", ".xls"]:
            raise HTTPException(status_code=400, detail="切换工作表只支持 Excel 文件")

        try:
            df, sheet_names = load_preview_data(
                file_path=file_path,
                file_type="excel",
                max_rows=max_rows,
                sheet_name=sheet_name,
            )

            data = []
            for _, row in df.iterrows():
                row_data = [str(cell) for cell in row.tolist()[:max_cols]]
                data.append(row_data)

            logger.info(f"[PREVIEW] 切换工作表成功: {file_name} -> {sheet_name}, 行数: {len(df)}")

            return FilePreviewResponse(
                success=True,
                data=data,
                file_type="excel",
                file_name=file_name,
                total_rows=len(df),
                total_cols=len(data[0]) if data else 0,
                sheets=sheet_names,
                current_sheet=sheet_name,
            )

        except ValueError as e:
            if "Worksheet" in str(e):
                raise HTTPException(status_code=404, detail=f"工作表 '{sheet_name}' 不存在") from e
            raise HTTPException(status_code=500, detail=f"读取工作表失败: {str(e)}") from e
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"读取Excel文件失败: {str(e)}") from e

    except HTTPException:
        raise
    except Exception as e:
        logger.info(f"[PREVIEW] 切换工作表错误: {str(e)}")
        import traceback

        traceback.print_exc()
        return FilePreviewResponse(
            success=False,
            data=None,
            file_type="excel",
            file_name="",
            error=f"切换工作表时发生错误: {str(e)}",
        )
