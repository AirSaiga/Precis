"""
@fileoverview 数据校验路由模块（基于文件上传）

功能概述:
- 提供基于文件上传的数据校验接口（非路径访问模式）
- 支持多种校验类型（唯一性、非空、允许值、外键、正则等）
- 支持正则表达式校验（含匹配模式、大小写敏感等参数）
- 支持批量校验请求处理
- 使用临时文件存储上传内容，处理完成后自动清理
- 通过 UnifiedValidationService 统一调度各类校验逻辑

架构设计:
- 基于 FastAPI APIRouter 组织路由，挂载到 /validation 前缀下
- 使用 UploadFile/Form 接收前端上传的文件和表单参数
- 统一返回 ValidationResponse / RegexValidationResponse 标准化响应结构
- 调用 UnifiedValidationService 和 load_file_data 完成数据加载与校验

输入示例:
    POST /validate/content
    FormData:
      - file: users.xlsx (上传文件)
      - validation_type: Unique
      - target_column_name: email
      - sheet_name: Sheet1
      - header_row: 0
      - validation_config: {"case_sensitive": true}
      - allow_unsafe_eval: false

输出示例:
    {
      "success": true,
      "validation_type": "Unique",
      "data": {
        "is_valid": false,
        "error_count": 3,
        "total_rows": 100,
        "match_count": null,
        "error_rows": [{"row_index": 5, "cell_value": "dup@example.com", "error_message": "重复值"}],
        "validation_time": 0.12
      },
      "error": null
    }
"""

from __future__ import annotations

import logging
import os
import tempfile
import time

from fastapi import File, Form, HTTPException, UploadFile

from app.api.models import (
    RegexValidationRequest,
    RegexValidationResponse,
    ValidationRequest,
    ValidationResponse,
)
from app.api.routers.validation.common import (
    convert_validation_result_to_regex,
    execute_standard_validation,
)
from app.shared.services.preview.path import validate_file_access
from app.shared.services.validation import UnifiedValidationService, ValidationType, load_file_data

from .router import router

logger = logging.getLogger(__name__)


@router.post(
    "/validate",
    response_model=ValidationResponse,
    summary="基于 JSON 请求体的单条数据校验",
    responses={
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_data(request: ValidationRequest):
    """
    基于 JSON 请求体的单条数据校验接口。

    参数:
        request (ValidationRequest): 校验请求体，包含文件路径、校验类型、目标列、配置等

    返回值:
        ValidationResponse: 标准化校验响应，包含校验结果、错误信息、统计数据等

    业务逻辑:
        1. 记录请求开始时间
        2. 确定表头行号（默认第 0 行）
        3. 调用 load_file_data 加载数据文件为 DataFrame
        4. 检查目标列是否存在于 DataFrame 中
        5. 调用 UnifiedValidationService.validate 执行具体校验逻辑
        6. 将错误行数据转换为 ValidationErrorRow 列表
        7. 组装 ValidationResult 并包装为 ValidationResponse 返回
        8. 捕获文件未找到和通用异常，返回友好的错误响应
    """
    try:
        _start_time = time.time()

        # 校验文件路径格式合法性（防止路径遍历攻击）
        if request.source_file_path:
            validate_file_access(request.source_file_path)

        return execute_standard_validation(
            source_file_path=request.source_file_path,
            sheet_name=request.sheet_name,
            header_row=request.header_row,
            validation_type=request.validation_type,
            target_column_name=request.target_column_name,
            validation_config=request.validation_config,
            allow_unsafe_eval=request.allow_unsafe_eval,
        )

    except FileNotFoundError as e:
        # 文件未找到时返回明确的错误提示
        return ValidationResponse(success=False, validation_type=request.validation_type, data=None, error=str(e))
    except Exception as e:
        # 捕获所有未预期异常，防止服务端崩溃，返回通用错误信息
        return ValidationResponse(
            success=False,
            validation_type=request.validation_type,
            data=None,
            error=f"校验过程中发生错误: {str(e)}",
        )


@router.post(
    "/validate/content",
    response_model=ValidationResponse,
    summary="基于文件上传的单条数据校验（Content 模式）",
    responses={
        400: {"description": "文件内容为空"},
        500: {"description": "校验过程中发生错误"},
    },
)
async def validate_data_with_file(
    file: UploadFile = File(...),
    validation_type: str = Form(...),
    target_column_name: str = Form(...),
    sheet_name: str = Form(None),
    header_row: int = Form(0),
    validation_config: str = Form(None),
    allow_unsafe_eval: bool = Form(False),
):
    """
    基于文件上传的单条数据校验接口（Content 模式）。

    参数:
        file (UploadFile): 上传的数据文件（Excel/CSV 等），必填
        validation_type (str): 校验类型，如 Unique、NotNull、Regex 等，必填
        target_column_name (str): 需要校验的目标列名，必填
        sheet_name (str): Excel 工作表名称，可选，默认为 None
        header_row (int): 表头所在行号，可选，默认为 0
        validation_config (str): JSON 格式的校验配置字符串，可选
        allow_unsafe_eval (bool): 是否允许不安全的表达式求值，可选，默认为 False

    返回值:
        ValidationResponse: 标准化校验响应

    业务逻辑:
        1. 接收上传的文件和表单参数
        2. 读取文件内容并写入系统临时文件（带原文件扩展名）
        3. 调用 load_file_data 从临时文件加载数据
        4. 检查目标列是否存在
        5. 解析 validation_config JSON 字符串为字典
        6. 调用 UnifiedValidationService.validate 执行校验
        7. 转换错误行数据并组装响应
        8. 在 finally 块中清理临时文件，避免磁盘泄漏
        9. 记录校验完成日志，捕获并处理所有异常
    """
    tmp_path = None
    try:
        # 记录校验开始时间
        _start_time = time.time()

        # 记录收到的校验请求基本信息，便于后续排查问题
        logger.info(f"[VALIDATION] 收到FormData校验请求: {file.filename}")
        logger.info(f"[VALIDATION] 校验类型: {validation_type}, 目标列: {target_column_name}")

        # 获取上传文件的原始名称和扩展名，用于创建临时文件时保留格式
        file_name = file.filename or "unknown"
        file_ext = os.path.splitext(file_name)[1].lower()
        # 异步读取上传文件的二进制内容
        content = file.read()

        # 如果文件内容为空，直接返回 400 错误
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")

        # 创建带原扩展名的临时文件，delete=False 确保我们可以手动控制删除时机
        with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            # 解析前端传来的 JSON 配置字符串，解析失败则使用空配置并记录错误日志
            config = {}
            if validation_config:
                import json

                try:
                    config = json.loads(validation_config)
                except json.JSONDecodeError:
                    logger.error("[VALIDATION] validation_config 解析失败，使用空配置")

            response = execute_standard_validation(
                source_file_path=tmp_path,
                sheet_name=sheet_name,
                header_row=header_row,
                validation_type=validation_type,
                target_column_name=target_column_name,
                validation_config=config,
                allow_unsafe_eval=allow_unsafe_eval,
            )

            if response.success and response.data:
                logger.info(f"[VALIDATION] 校验完成: 成功={response.data.is_valid}, 错误数={response.data.error_count}")

            return response

        finally:
            # 无论校验成功与否，都尝试删除临时文件，防止磁盘空间泄漏
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except Exception as e:
                    logger.error(f"[VALIDATION] 删除临时文件失败: {e}")

    except HTTPException:
        # FastAPI 的 HTTPException 直接抛出，由框架处理响应
        raise
    except Exception as e:
        # 捕获所有未预期异常，记录详细错误堆栈并返回友好错误信息
        logger.error(f"[VALIDATION] 校验异常: {str(e)}")
        import traceback

        traceback.print_exc()
        return ValidationResponse(
            success=False,
            validation_type=validation_type,
            data=None,
            error=f"校验过程中发生错误: {str(e)}",
        )


@router.post(
    "/regex",
    response_model=RegexValidationResponse,
    summary="基于 JSON 请求体的正则表达式校验",
    responses={
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_regex(request: RegexValidationRequest):
    """
    基于 JSON 请求体的正则表达式校验接口。

    参数:
        request (RegexValidationRequest): 正则校验请求体，包含文件路径、正则模式、
                                         匹配模式、大小写敏感设置、目标列等

    返回值:
        RegexValidationResponse: 正则校验专用响应模型，包含匹配统计和错误行信息

    业务逻辑:
        1. 记录请求开始时间
        2. 调用 load_file_data 加载数据文件，支持自定义表头
        3. 检查目标列是否存在
        4. 调用 UnifiedValidationService.validate 执行 REGEX 类型校验
        5. 使用 convert_validation_result_to_regex 转换结果为正则响应模型
        6. 返回标准化响应，捕获文件未找到和通用异常
    """
    try:
        _start_time = time.time()

        # 校验文件路径格式合法性（防止路径遍历攻击）
        if request.source_file_path:
            validate_file_access(request.source_file_path)

        # 加载数据文件，支持自定义表头配置
        df = load_file_data(
            source_file_path=request.source_file_path,
            sheet_name=request.sheet_name,
            header_columns=request.header_columns,
            use_custom_header=request.use_custom_header or False,
        )

        # 检查目标列是否存在于数据中
        if request.target_column_name not in df.columns:
            return RegexValidationResponse(success=False, data=None, error=f"未找到列: {request.target_column_name}")

        # 调用统一校验服务执行正则校验，传入正则模式、标志、匹配模式和大小写敏感设置
        result = UnifiedValidationService.validate(
            validation_type=ValidationType.REGEX,
            df=df,
            column=request.target_column_name,
            regex_pattern=request.regex_pattern,
            regex_flags=request.regex_flags or "",
            match_mode=request.match_mode,
            case_sensitive=request.case_sensitive,
        )

        # 将通用校验结果转换为正则专用响应模型
        regex_result = convert_validation_result_to_regex(result)

        return RegexValidationResponse(success=True, data=regex_result, error=None)

    except FileNotFoundError as e:
        # 文件未找到时返回错误响应
        return RegexValidationResponse(success=False, data=None, error=str(e))
    except Exception as e:
        # 通用异常处理，防止服务端崩溃
        return RegexValidationResponse(success=False, data=None, error=f"校验过程中发生错误: {str(e)}")


@router.post(
    "/validate/batch",
    response_model=dict,
    summary="批量数据校验",
    responses={
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_batch(requests: list[ValidationRequest]):
    """
    批量数据校验接口（基于 JSON 请求体列表）。

    参数:
        requests (list[ValidationRequest]): 校验请求对象列表，每个元素为独立的校验请求

    返回值:
        dict: 包含 results 键的字典，值为所有单条校验结果的列表

    业务逻辑:
        1. 遍历传入的请求列表
        2. 对每个请求调用 validate_data 执行单条校验
        3. 收集每条请求的校验类型、目标列、成功状态、结果数据和错误信息
        4. 将所有结果组装为统一字典返回
    """
    # 存储所有批量校验结果的列表
    results = []
    # 逐条处理每个校验请求
    for request in requests:
        # 复用单条校验接口的逻辑
        response = validate_data(request)
        # 提取关键信息组装为简洁的结果字典
        results.append(
            {
                "validation_type": request.validation_type,
                "target_column": request.target_column_name,
                "success": response.success,
                # 如果校验成功且有数据，将结果对象转为字典；否则为 None
                "result": response.data.model_dump() if response.data else None,
                "error": response.error,
            }
        )
    # 返回包含所有结果的响应字典
    return {"results": results}
