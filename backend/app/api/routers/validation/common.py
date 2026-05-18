"""
@fileoverview 校验结果转换工具模块

功能概述:
- 提供校验结果到正则校验响应模型的统一转换函数
- 将后端通用的校验结果格式转换为前端 RegexValidationResult 模型所需的数据结构
- 提供标准数据校验执行流水线，被 content_mode 和 path_mode 共用

架构设计:
- 作为纯工具函数模块，无状态无副作用
- 被 content_mode.py 和 path_mode.py 共用，避免重复代码

输入示例:
    result = ValidationResult(
        is_valid=False,
        error_count=2,
        total_rows=100,
        match_count=98,
        error_rows=[{"row_index": 5, "cell_value": "abc"}],
        validation_time=0.15,
    )

输出示例:
    RegexValidationResult(
        is_valid=False,
        error_count=2,
        total_rows=100,
        match_count=98,
        error_rows=[{"row_index": 5, "cell_value": "abc"}],
        validation_time=0.15,
    )
"""

from __future__ import annotations

from app.api.models import (
    RegexValidationResult,
    ValidationErrorRow,
    ValidationResponse,
    ValidationResult,
)
from app.shared.services.validation import UnifiedValidationService, load_file_data


def convert_validation_result_to_regex(result) -> RegexValidationResult:
    """
    将通用校验结果转换为正则校验响应模型。

    参数:
        result: 通用校验结果对象，包含 is_valid、error_count、total_rows、
                match_count、error_rows、validation_time 等属性

    返回值:
        RegexValidationResult: 适配正则校验接口的标准化响应模型

    业务逻辑:
        1. 遍历 result.error_rows，提取每行的 row_index 和 cell_value
        2. 将原始错误行数据转换为字典列表格式
        3. 组装成 RegexValidationResult 对象返回，match_count 为空时默认补 0
    """
    # 提取错误行信息：将原始错误行对象转换为前端需要的字典格式
    error_rows = [
        {"row_index": err.get("row_index", 0), "cell_value": err.get("cell_value")} for err in result.error_rows
    ]
    # 组装正则校验响应模型，match_count 为空时默认设置为 0
    return RegexValidationResult(
        is_valid=result.is_valid,
        error_count=result.error_count,
        total_rows=result.total_rows,
        match_count=result.match_count or 0,
        error_rows=error_rows,
        validation_time=result.validation_time,
    )


def execute_standard_validation(
    source_file_path: str,
    sheet_name: str | None,
    header_row: int | None,
    validation_type: str,
    target_column_name: str,
    validation_config: dict | None = None,
    allow_unsafe_eval: bool = False,
) -> ValidationResponse:
    """
    标准数据校验执行流水线，被 content_mode 和 path_mode 共用。

    调用方需自行处理文件加载前的准备工作（如路径访问权限校验、临时文件创建等）。

    参数:
        source_file_path: 数据源文件路径（已准备好的路径或临时文件路径）
        sheet_name: Excel 工作表名称，可选
        header_row: 表头所在行号，可选，默认为 0
        validation_type: 校验类型，如 Unique、NotNull 等
        target_column_name: 需要校验的目标列名
        validation_config: 校验配置字典，可选
        allow_unsafe_eval: 是否允许不安全的表达式求值，可选，默认为 False

    返回值:
        ValidationResponse: 标准化校验响应
    """
    # 从指定路径加载数据，支持 Excel/CSV 等格式
    df = load_file_data(
        source_file_path=source_file_path,
        sheet_name=sheet_name,
        header_row=header_row if header_row is not None else 0,
    )

    # 检查目标列是否存在于加载的数据中，不存在则直接返回错误
    if target_column_name not in df.columns:
        return ValidationResponse(
            success=False,
            validation_type=validation_type,
            data=None,
            error=f"未找到列: {target_column_name}",
        )

    # 调用统一校验服务执行实际校验逻辑
    result = UnifiedValidationService.validate(
        validation_type=validation_type,
        df=df,
        column=target_column_name,
        allow_unsafe_eval=allow_unsafe_eval,
        **(validation_config or {}),
    )

    # 将原始错误行列表转换为标准化的 ValidationErrorRow 对象列表
    error_rows = [
        ValidationErrorRow(
            row_index=err.get("row_index", 0),
            cell_value=str(err.get("cell_value", "")),
            error_message=err.get("error_message"),
        )
        for err in result.error_rows
    ]

    # 组装校验结果对象，包含是否通过、错误数、总行数、匹配数、错误行、耗时等
    validation_result = ValidationResult(
        is_valid=result.is_valid,
        error_count=result.error_count,
        total_rows=result.total_rows,
        match_count=result.match_count,
        error_rows=error_rows,
        validation_time=result.validation_time,
    )

    # 返回成功的标准化响应
    return ValidationResponse(success=True, validation_type=validation_type, data=validation_result, error=None)
