# backend/app/api/models/validation.py
"""
@fileoverview 校验请求/响应模型

功能概述:
- 定义数据校验相关的 Pydantic 数据模型
- 包含正则校验请求/响应、统一校验请求/响应、校验类型枚举等

输入示例:
    RegexValidationRequest(
        regex_pattern="^1[3-9]\\d{9}$",
        match_mode="full",
        target_column_name="phone",
        source_file_path="data/users.xlsx"
    )

输出示例:
    ValidationResponse(
        success=True,
        validation_type="regex",
        data=ValidationResult(
            is_valid=False,
            error_count=3,
            total_rows=100,
            error_rows=[...]
        )
    )
"""

from typing import Any, Optional

from pydantic import BaseModel, Field


class RegexValidationRequest(BaseModel):
    """
    正则表达式校验请求模型

    用于对数据列进行正则表达式模式匹配校验。

    Attributes:
        regex_pattern: 正则表达式模式
        regex_flags: 正则表达式标志（如 g, i, m）
        match_mode: 匹配模式（full/partial/extract）
        case_sensitive: 是否大小写敏感
        target_column_name: 目标列名
        source_file_path: 数据源文件路径
        sheet_name: Excel 工作表名称（可选）
        header_columns: 自定义表头列名列表（可选）
        use_custom_header: 是否使用自定义表头（可选）
    """

    regex_pattern: str = Field(..., description="正则表达式模式")  # 用于匹配的正则表达式字符串，必填
    regex_flags: Optional[str] = Field(None, description="正则表达式标志")  # 正则标志（如 g, i, m），可选
    match_mode: str = Field(
        default="full", description="匹配模式: full/partial/extract"
    )  # 匹配模式：full（全匹配）、partial（部分匹配）、extract（提取）
    case_sensitive: bool = Field(
        default=True, description="是否大小写敏感"
    )  # True 表示区分大小写，False 表示忽略大小写
    target_column_name: str = Field(..., description="目标列名")  # 需要进行正则校验的数据列名称，必填
    source_file_path: str = Field(
        ..., description="数据源文件路径"
    )  # 数据源文件（Excel/CSV/JSON）的绝对或相对路径，必填
    sheet_name: Optional[str] = Field(None, description="Excel工作表名称")  # 当数据源为 Excel 时指定工作表名称，可选
    header_columns: Optional[list[str]] = Field(
        None, description="自定义表头列名"
    )  # 自定义表头列名列表，用于覆盖文件第一行，可选
    use_custom_header: Optional[bool] = Field(None, description="是否使用自定义表头")  # 是否启用自定义表头覆盖，可选


class RegexValidationErrorRow(BaseModel):
    """
    正则校验错误行模型

    记录正则校验失败的具体行信息。

    Attributes:
        row_index: 行索引（从 0 开始）
        cell_value: 单元格原始值
    """

    row_index: int = Field(..., description="行索引")  # 数据行在源文件中的索引位置，从 0 开始计数
    cell_value: str = Field(..., description="单元格值")  # 该校验失败的单元格原始值


class RegexValidationResult(BaseModel):
    """
    正则表达式校验结果模型

    包含正则校验的详细结果信息。

    Attributes:
        is_valid: 校验是否通过
        error_count: 错误行数量
        total_rows: 总行数
        match_count: 匹配行数量
        error_rows: 错误行列表
        validation_time: 校验耗时时间戳
    """

    is_valid: bool = Field(..., description="校验是否通过")  # True 表示全部通过，False 表示存在错误行
    error_count: int = Field(..., description="错误数量")  # 校验失败的行数
    total_rows: int = Field(..., description="总行数")  # 参与校验的数据总行数（不含表头）
    match_count: int = Field(..., description="匹配数量")  # 正则匹配成功的行数
    error_rows: list[RegexValidationErrorRow] = Field(default=[], description="错误行列表")  # 校验失败的详细行信息列表
    validation_time: str = Field(..., description="校验时间")  # 校验执行完成的时间戳，ISO 8601 格式


class RegexValidationResponse(BaseModel):
    """
    正则表达式校验响应模型

    正则校验接口的标准响应格式。

    Attributes:
        success: 请求是否成功
        data: 校验结果详情
        error: 错误信息（如果有）
        schema_name: 关联的 Schema 名称（可选）
        updated_at: 更新时间（可选）
    """

    success: bool = Field(..., description="请求是否成功")  # True 表示请求处理成功，False 表示接口层面出错
    data: Optional[RegexValidationResult] = Field(
        None, description="校验结果"
    )  # 校验成功时返回的详细结果，失败时为 None
    error: Optional[str] = Field(None, description="错误信息")  # 请求处理失败时的错误描述，成功时为 None
    schema_name: Optional[str] = Field(None, description="Schema名称")  # 关联的 Schema 名称，用于前端展示上下文，可选
    updated_at: Optional[str] = Field(None, description="更新时间")  # 响应生成的时间戳，ISO 8601 格式，可选


# 统一使用 services 层的 ValidationType 作为唯一真相源
# API 层不再维护独立的校验类型定义，避免与服务层不一致
from app.shared.services.validation.types import ValidationType  # noqa: F401


class ValidationRequest(BaseModel):
    """
    统一校验请求模型

    用于通用数据校验接口的请求体。
    支持多种校验类型，通过 validation_type 字段指定。

    Attributes:
        validation_type: 校验类型（regex/unique/not_null/allowed_values/conditional/scripted）
        target_column_name: 目标列名
        source_file_path: 数据源文件路径
        sheet_name: Excel 工作表名称（可选）
        header_row: 表头行索引，0 表示第一行（可选）
        validation_config: 校验特定配置（字典）
        allow_unsafe_eval: 是否允许执行脚本化校验（eval 模式）
    """

    validation_type: str = Field(
        ..., description="校验类型: regex/unique/not_null/allowed_values/conditional/scripted"
    )  # 指定要执行的校验类型，必填
    target_column_name: str = Field(..., description="目标列名")  # 需要校验的数据列名称，必填
    source_file_path: str = Field(
        ..., description="数据源文件路径"
    )  # 数据源文件（Excel/CSV/JSON）的绝对或相对路径，必填
    sheet_name: Optional[str] = Field(None, description="Excel工作表名称")  # 当数据源为 Excel 时指定工作表名称，可选
    header_row: Optional[int] = Field(
        None, description="表头行索引，0表示第一行"
    )  # 指定表头所在行索引，0 表示第一行，可选
    validation_config: Optional[dict] = Field(
        default={}, description="校验特定配置"
    )  # 各类校验的特定配置参数（如 allowed_values 的值列表），默认为空字典
    allow_unsafe_eval: bool = Field(
        False, description="是否允许执行脚本化校验（eval模式）"
    )  # True 允许执行脚本化校验（存在安全风险），默认关闭


class InlineValidationRequest(BaseModel):
    """
    行内数据校验请求模型

    用于纯数据节点（TransformOutput / ManualData）的行内校验接口。
    直接接收行数据，无需文件路径。

    Attributes:
        validation_type: 校验类型（not_null/unique/allowed_values/range/charset/scripted/foreign_key 等）
        target_column_name: 目标列名
        rows: 行数据二维数组，默认第一行为表头（与 TransformOutput/ManualData 的 rows 结构一致）
        column_names: 列名列表，当提供时 rows 全部视为数据行（覆盖默认的第一行表头行为）
        validation_config: 校验特定配置（字典）
        allow_unsafe_eval: 是否允许执行脚本化校验（eval 模式）
    """

    validation_type: str = Field(
        ..., description="校验类型"
    )  # 指定要执行的校验类型（如 not_null/unique/range 等），必填
    target_column_name: str = Field(..., description="目标列名")  # 需要校验的数据列名称，必填
    rows: list[list[Any]] = Field(
        ..., description="行数据，默认第一行为表头"
    )  # 二维数组形式的行数据，默认第一行为表头，后续行为数据
    column_names: list[str] = Field(
        default=[], description="列名列表（提供时 rows 全部视为数据行）"
    )  # 显式指定列名时，rows 全部视为数据行（不再将第一行作为表头）
    validation_config: Optional[dict] = Field(
        default={}, description="校验特定配置"
    )  # 各类校验的特定配置参数，默认为空字典
    allow_unsafe_eval: bool = Field(
        False, description="是否允许执行脚本化校验（eval模式）"
    )  # True 允许执行脚本化校验（存在安全风险），默认关闭


class ValidationErrorRow(BaseModel):
    """
    校验错误行模型

    记录数据校验失败的具体行信息。

    Attributes:
        row_index: 行索引（从 0 开始）
        cell_value: 单元格原始值
        error_message: 错误描述信息（可选）
    """

    row_index: int = Field(..., description="行索引")  # 数据行在源文件或行内数据中的索引位置，从 0 开始计数
    cell_value: str = Field(..., description="单元格值")  # 该校验失败的单元格原始值
    error_message: Optional[str] = Field(
        None, description="错误信息"
    )  # 校验失败的具体错误描述，如"值不在允许列表中"，可选


class ValidationResult(BaseModel):
    """
    校验结果模型

    包含通用校验的详细结果信息。

    Attributes:
        is_valid: 校验是否通过
        error_count: 错误行数量
        total_rows: 总行数
        match_count: 匹配行数量（可选）
        error_rows: 错误行列表
        validation_time: 校验耗时
    """

    is_valid: bool = Field(..., description="校验是否通过")  # True 表示全部通过，False 表示存在错误行
    error_count: int = Field(..., description="错误数量")  # 校验失败的行数
    total_rows: int = Field(..., description="总行数")  # 参与校验的数据总行数（不含表头）
    match_count: Optional[int] = Field(
        None, description="匹配数量"
    )  # 匹配成功的行数（部分校验类型适用，如 regex），可选
    error_rows: list[ValidationErrorRow] = Field(default=[], description="错误行列表")  # 校验失败的详细行信息列表
    validation_time: str = Field(..., description="校验耗时")  # 校验执行耗时，通常以毫秒或秒为单位的字符串


class ValidationResponse(BaseModel):
    """
    统一校验响应模型

    校验接口的标准响应格式。

    Attributes:
        success: 请求是否成功
        validation_type: 执行的校验类型
        data: 校验结果详情
        error: 错误信息（如果有）
    """

    success: bool = Field(..., description="请求是否成功")  # True 表示请求处理成功，False 表示接口层面出错
    validation_type: str = Field(
        ..., description="执行的校验类型"
    )  # 实际执行的校验类型标识，与请求中的 validation_type 对应
    data: Optional[ValidationResult] = Field(None, description="校验结果")  # 校验成功时返回的详细结果，失败时为 None
    error: Optional[str] = Field(None, description="错误信息")  # 请求处理失败时的错误描述，成功时为 None
