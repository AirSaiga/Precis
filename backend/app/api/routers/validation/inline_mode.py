"""
@fileoverview 数据校验路由模块（基于行内数据）

功能概述:
- 提供基于行内数据（TransformOutput / ManualData 节点）的校验接口
- 直接接收二维数组行数据，无需文件路径
- 支持多种校验类型（唯一性、非空、允许值、区间、字符集、脚本、外键等）
- 通过 UnifiedValidationService 统一调度各类校验逻辑

架构设计:
- 基于 FastAPI APIRouter 组织路由，挂载到 /validation 前缀下
- 将行数据转为 pandas DataFrame，复用 execute_dataframe_validation 流水线
- 统一返回 ValidationResponse 标准化响应结构

输入示例:
    POST /validate/inline
    Body:
    {
      "validation_type": "not_null",
      "target_column_name": "name",
      "rows": [["name", "age"], ["Alice", "25"], ["", "30"], ["Bob", ""]]
    }

输出示例:
    {
      "success": true,
      "validation_type": "not_null",
      "data": {
        "is_valid": false,
        "error_count": 1,
        "total_rows": 3,
        "error_rows": [{"row_index": 1, "cell_value": "", "error_message": null}],
        "validation_time": "0.001s"
      },
      "error": null
    }
"""

from __future__ import annotations

import logging

import pandas as pd

from app.api.models import InlineValidationRequest, ValidationResponse
from app.api.routers.validation.common import execute_dataframe_validation

from .router import router

logger = logging.getLogger(__name__)


@router.post(
    "/validate/inline",
    response_model=ValidationResponse,
    summary="基于行内数据的校验（Inline 模式）",
    responses={
        500: {"description": "校验过程中发生错误"},
    },
)
def validate_data_inline(request: InlineValidationRequest):
    """
    基于行内数据的校验接口（Inline 模式）。

    专为前端纯数据节点（TransformOutput / ManualData）设计，
    直接接收二维行数据数组，转换为 DataFrame 后复用统一校验流水线。

    参数:
        request (InlineValidationRequest): 校验请求体，包含行数据、校验类型、目标列、配置等

    返回值:
        ValidationResponse: 标准化校验响应

    业务逻辑:
        1. 验证 rows 数据不为空
        2. 根据是否提供 column_names，决定表头来源（第一行 or column_names）
        3. 构建 pandas DataFrame
        4. 对目标列做类型推断（与文件加载行为保持一致）
        5. 调用 execute_dataframe_validation 执行校验
        6. 捕获异常并返回友好错误信息
    """
    try:
        # 验证行数据不为空
        if not request.rows:
            return ValidationResponse(
                success=False,
                validation_type=request.validation_type,
                data=None,
                error="行数据不能为空",
            )

        # 构建 DataFrame：根据 column_names 决定表头来源
        if request.column_names:
            # column_names 已提供：所有 rows 均为数据行
            df = pd.DataFrame(request.rows, columns=request.column_names)
        else:
            # 默认：第一行为表头，其余为数据行
            if len(request.rows) < 2:
                return ValidationResponse(
                    success=False,
                    validation_type=request.validation_type,
                    data=None,
                    error="行数据至少需要包含表头行和一行数据",
                )
            header = [str(col) for col in request.rows[0]]
            df = pd.DataFrame(request.rows[1:], columns=header)

        logger.info(
            f"[INLINE] 收到行内校验请求: type={request.validation_type}, "
            f"column={request.target_column_name}, rows={len(df)}"
        )

        # 委托给共享流水线执行校验
        # 传递 column_data_type 让后端按 Schema 类型转换，保持与全量校验一致
        return execute_dataframe_validation(
            df=df,
            validation_type=request.validation_type,
            target_column_name=request.target_column_name,
            validation_config=request.validation_config,
            allow_unsafe_eval=request.allow_unsafe_eval,
            column_data_type=request.column_data_type,
        )

    except Exception as e:
        logger.error(f"[INLINE] 行内校验异常: {str(e)}")
        import traceback

        traceback.print_exc()
        return ValidationResponse(
            success=False,
            validation_type=request.validation_type,
            data=None,
            error=f"行内校验过程中发生错误: {str(e)}",
        )
