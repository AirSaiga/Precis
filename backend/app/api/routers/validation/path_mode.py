"""
@fileoverview 数据校验路由模块（基于文件路径访问）

功能概述:
- 提供基于文件路径的数据校验接口
- 支持多种校验类型（唯一性、非空、允许值、外键、正则等）
- 支持正则表达式校验（含匹配模式、大小写敏感等参数）
- 支持批量校验请求处理
- 通过 UnifiedValidationService 统一调度各类校验逻辑

架构设计:
- 基于 FastAPI APIRouter 组织路由，挂载到 /validation 前缀下
- 直接通过文件路径加载数据，无需上传文件
- 统一返回 ValidationResponse / RegexValidationResponse 标准化响应结构

输入示例:
    POST /validate/path
    Body:
    {
      "source_file_path": "/data/users.xlsx",
      "validation_type": "Unique",
      "target_column_name": "email",
      "sheet_name": "Sheet1",
      "header_row": 0,
      "validation_config": {"case_sensitive": true}
    }

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
import time

from fastapi import HTTPException

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
from app.shared.services.preview.path_validation import validate_file_access
from app.shared.services.validation import UnifiedValidationService, ValidationType, load_file_data

from .router import router

logger = logging.getLogger(__name__)


@router.post(
    "/validate/path",
    response_model=ValidationResponse,
    summary="基于文件路径的单条数据校验（Path 模式）",
    responses={
        404: {"description": "文件未找到"},
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_data_with_path(request: ValidationRequest):
    """
    基于文件路径的单条数据校验接口（Path 模式）。

    参数:
        request (ValidationRequest): 校验请求体，包含文件路径、校验类型、目标列、配置等

    返回值:
        ValidationResponse: 标准化校验响应

    业务逻辑:
        1. 记录请求开始时间和基本信息日志
        2. 校验文件路径是否为空
        3. 调用 validate_file_path 校验路径格式合法性
        4. 检查文件是否在磁盘上真实存在
        5. 确定表头行号并加载数据文件
        6. 检查目标列是否存在
        7. 调用 UnifiedValidationService.validate 执行具体校验
        8. 转换错误行数据并组装响应
        9. 记录校验完成状态，捕获并处理异常
    """
    try:
        # 记录校验开始时间
        _start_time = time.time()

        # 记录收到的路径校验请求信息，便于排查问题
        logger.info(f"[VALIDATION] 收到路径校验请求: {request.source_file_path}")
        logger.info(f"[VALIDATION] 校验类型: {request.validation_type}, 目标列: {request.target_column_name}")

        source_file_path = request.source_file_path

        # 检查文件路径是否为空，为空则直接返回错误
        if not source_file_path:
            return ValidationResponse(
                success=False, validation_type=request.validation_type, data=None, error="文件路径不能为空"
            )

        # 校验文件路径格式是否合法（如防止路径遍历攻击）
        validate_file_access(source_file_path)

        response = execute_standard_validation(
            source_file_path=source_file_path,
            sheet_name=request.sheet_name,
            header_row=request.header_row,
            validation_type=request.validation_type,
            target_column_name=request.target_column_name,
            validation_config=request.validation_config,
            column_data_type=request.column_data_type,
        )

        # 记录校验完成状态
        if response.success and response.data:
            logger.info(f"[VALIDATION] 路径校验完成: 成功={response.data.is_valid}, 错误数={response.data.error_count}")

        return response

    except FileNotFoundError as e:
        return ValidationResponse(success=False, validation_type=request.validation_type, data=None, error=str(e))
    except HTTPException as e:
        return ValidationResponse(success=False, validation_type=request.validation_type, data=None, error=e.detail)
    except Exception as e:
        # 捕获所有未预期异常，记录详细堆栈并返回友好错误信息
        logger.error(f"[VALIDATION] 路径校验异常: {str(e)}")
        import traceback

        traceback.print_exc()
        return ValidationResponse(
            success=False,
            validation_type=request.validation_type,
            data=None,
            error=f"校验过程中发生错误: {str(e)}",
        )


@router.post(
    "/regex/path",
    response_model=RegexValidationResponse,
    summary="基于文件路径的正则表达式校验（Path 模式）",
    responses={
        404: {"description": "文件未找到"},
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_regex_with_path(request: RegexValidationRequest):
    """
    基于文件路径的正则表达式校验接口（Path 模式）。

    参数:
        request (RegexValidationRequest): 正则校验请求体，包含文件路径、正则模式、
                                         匹配模式、大小写敏感设置、目标列等

    返回值:
        RegexValidationResponse: 正则校验专用响应模型

    业务逻辑:
        1. 记录请求开始时间和基本信息日志
        2. 校验文件路径是否为空
        3. 调用 validate_file_path 校验路径格式合法性
        4. 检查文件是否在磁盘上真实存在
        5. 加载数据文件，支持自定义表头配置
        6. 检查目标列是否存在
        7. 调用 UnifiedValidationService.validate 执行 REGEX 类型校验
        8. 使用 convert_validation_result_to_regex 转换结果
        9. 记录校验完成状态，返回响应
    """
    try:
        # 记录校验开始时间
        _start_time = time.time()

        # 记录收到的路径正则校验请求信息
        logger.info(f"[REGEX] 收到路径正则校验请求: {request.source_file_path}")
        logger.info(f"[REGEX] 正则模式: {request.regex_pattern}, 目标列: {request.target_column_name}")

        source_file_path = request.source_file_path

        # 检查文件路径是否为空
        if not source_file_path:
            return RegexValidationResponse(success=False, data=None, error="文件路径不能为空")

        # 校验文件路径格式合法性
        validate_file_access(source_file_path)

        # 加载数据文件，支持自定义表头
        df = load_file_data(
            source_file_path=source_file_path,
            sheet_name=request.sheet_name,
        )

        # 检查目标列是否存在于数据中
        if request.target_column_name not in df.columns:
            return RegexValidationResponse(success=False, data=None, error=f"未找到列: {request.target_column_name}")

        # 调用统一校验服务执行正则校验
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

        # 记录正则校验完成状态
        logger.info(f"[REGEX] 路径正则校验完成: 成功={result.is_valid}, 匹配数={result.match_count}")

        return RegexValidationResponse(success=True, data=regex_result, error=None)

    except FileNotFoundError as e:
        return RegexValidationResponse(success=False, data=None, error=str(e))
    except HTTPException as e:
        return RegexValidationResponse(success=False, data=None, error=e.detail)
    except Exception as e:
        logger.error(f"[REGEX] 路径正则校验异常: {str(e)}")
        import traceback

        traceback.print_exc()
        return RegexValidationResponse(success=False, data=None, error=f"校验过程中发生错误: {str(e)}")


@router.post(
    "/validate/path/batch",
    response_model=dict,
    summary="批量数据校验（Path 模式）",
    responses={
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_batch_with_path(requests: list[ValidationRequest]):
    """
    批量数据校验接口（基于文件路径）。

    参数:
        requests (list[ValidationRequest]): 校验请求对象列表，每个元素包含文件路径和校验配置

    返回值:
        dict: 包含 results 键的字典，值为所有单条校验结果的列表

    业务逻辑:
        1. 遍历传入的请求列表
        2. 对每个请求调用 validate_data_with_path 执行单条路径模式校验
        3. 收集每条请求的校验类型、目标列、成功状态、结果数据和错误信息
        4. 将所有结果组装为统一字典返回
    """
    # 存储所有批量校验结果的列表
    results = []
    # 逐条处理每个校验请求
    for request in requests:
        # 复用路径模式单条校验接口的逻辑
        response = validate_data_with_path(request)
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
