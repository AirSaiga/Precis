r"""
@fileoverview 校验加载器模块

功能概述:
- 提供数据文件加载功能,支持 Excel、CSV、JSON、JSON Lines 格式
- 提供基础文件加载(load_file_data)和带配置加载(load_file_data_with_settings)
- 提供校验执行入口(run_validation、validate_with_settings)
- 支持编码自动检测、CSV 自定义分隔符
- 支持 JSONPath 提取和嵌套 JSON 扁平化

架构设计:
- 分层设计: 底层文件加载 -> 上层校验执行
- 双模式支持: 基础模式(参数直传)和配置模式(Settings 对象)
- 文件加载层处理格式和编码,校验层专注业务逻辑
- 编码检测采用优先级策略: UTF-8 -> GBK -> GB2312 -> GB18030 -> Big5 -> Latin1

输入示例:
    # 加载 Excel 文件
    df = load_file_data(
        source_file_path="data/users.xlsx",
        sheet_name="Sheet1",
        header_row=0
    )

    # 带配置加载 CSV
    settings = FileProcessingSettings(default_encoding="utf-8", csv_delimiter=",")
    df = load_file_data_with_settings("data/products.csv", settings=settings)

输出示例:
    # 返回 pandas DataFrame
    #    id  name  email
    # 0   1  张三  zhangsan@example.com

    # 执行校验返回 ValidationResult
    result = run_validation(
        validation_type="regex",
        source_file_path="data/users.xlsx",
        target_column_name="email",
        regex_pattern=r"^[\\w\\.-]+@[\\w\\.-]+\\.\w+$"
    )
"""

import logging
import os
from typing import TYPE_CHECKING, Any, Optional

import pandas as pd

from .service import UnifiedValidationService
from .types import ValidationResult

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.shared.services.validation.service import FileProcessingSettings, ValidationSettings


def load_file_data(
    source_file_path: str,
    sheet_name: Optional[str] = None,
    header_row: int = 0,
    source_config: Optional[dict[str, Any]] = None,
) -> pd.DataFrame:
    """
    @methoddesc 加载数据文件为基础 DataFrame

    读取指定路径的数据文件（Excel、CSV 或 JSON），并转换为 pandas DataFrame 进行处理。
    支持通过 source_config 传递高级配置（如 JSON 的 json_path、format 等）。

    支持的文件格式：
    - Excel (.xlsx, .xls): 使用 openpyxl 引擎，支持多 sheet
    - CSV (.csv): 默认 UTF-8 编码
    - JSON (.json): 支持对象数组和嵌套对象（自动扁平化）
    - JSON Lines (.jsonl): 每行一个 JSON 对象，适合大文件

    参数:
        source_file_path: 源文件路径，支持绝对路径和相对路径
        sheet_name: Excel 文件的工作表名称，若为 None 则读取第一个工作表
        header_row: 用作列名的行索引，默认为 0（第一行，JSON 文件忽略此参数）
        source_config: 数据源配置字典（可选），用于 JSON 等格式的高级配置
            - format: JSON 格式类型 (auto/array/lines/object)
            - json_path: JSONPath 提取路径，如 "$.data.items"
            - sep: 嵌套对象展平分隔符

    返回:
        转换后的 pandas DataFrame 对象，空值被统一处理为 None

    异常:
        FileNotFoundError: 指定的文件不存在
        ValueError: 不支持的文件类型或 JSON 数据结构

    副作用:
        将 pandas 的 NaN 值和空字符串转换为 Python 的 None，保持数据一致性
    """
    # 检查文件是否存在
    # 【副作用】如果文件不存在，抛出 FileNotFoundError
    if not os.path.exists(source_file_path):
        raise FileNotFoundError(f"文件不存在: {source_file_path}")

    from app.shared.core.data_source.loaders import load_source_data
    from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
    from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
    from app.shared.core.data_source.specs.json_source import JSONSourceSpec

    file_ext = os.path.splitext(source_file_path)[1].lower()
    sc = source_config or {}

    # 处理无表头模式（header_row=-1 表示没有表头行）
    header_enabled = header_row >= 0
    effective_header_row = header_row if header_row >= 0 else 0

    if file_ext in [".xlsx", ".xls"]:
        spec = ExcelSourceSpec(
            path=source_file_path,
            sheet=sheet_name,
            header_row=effective_header_row,
            header_enabled=header_enabled,
        )
    elif file_ext == ".csv":
        spec = CSVSourceSpec(
            path=source_file_path,
            header_row=effective_header_row,
            header_enabled=header_enabled,
            encoding=sc.get("encoding", "utf-8"),
            delimiter=sc.get("delimiter", ","),
        )
    elif file_ext in [".json", ".jsonl"]:
        fmt = sc.get("format", "auto")
        if file_ext == ".jsonl":
            fmt = "lines"
        spec = JSONSourceSpec(
            path=source_file_path,
            header_row=effective_header_row,
            header_enabled=header_enabled,
            format=fmt,
            json_path=sc.get("json_path"),
            record_path=sc.get("record_path"),
            meta_prefix=sc.get("meta_prefix", "meta."),
            sep=sc.get("sep", "."),
            dtype=sc.get("dtype"),
            flatten=sc.get("flatten", True),
        )
    else:
        raise ValueError(f"不支持的文件类型: {file_ext}")

    df = load_source_data(spec)
    # 数据清洗：将 NaN 和空字符串统一转换为 None，便于后续处理
    # 【副作用】统一空值表示，便于后续校验逻辑处理
    df = df.where(pd.notnull(df), None)
    df = df.replace("", None)

    return df


def run_validation(
    validation_type: str,
    source_file_path: str,
    target_column_name: str,
    sheet_name: Optional[str] = None,
    header_columns: Optional[list[str]] = None,
    use_custom_header: bool = False,
    **validation_config,
) -> ValidationResult:
    """
    @methoddesc 执行数据校验的主入口函数

    该函数封装了从文件加载到校验执行的全部流程，为调用方提供简洁的 API。
    支持自定义列名和灵活的配置参数传递。

    数据流：
    1. 确定 header 行索引
    2. 加载文件数据
    3. 应用自定义列名（如果需要）
    4. 调用统一校验服务执行校验
    5. 返回校验结果

    参数:
        validation_type: 校验类型，对应 ValidationType 中的常量
        source_file_path: 源数据文件路径
        target_column_name: 目标列名，即需要校验的列
        sheet_name: Excel 工作表名称（可选）
        header_columns: 自定义列名列表（可选），配合 use_custom_header 使用
        use_custom_header: 是否使用自定义列名，True 时 header_row 设为 -1
        **validation_config: 其他校验配置参数，将传递给具体验证器

    返回:
        ValidationResult: 校验结果对象，包含校验状态和错误详情
    """
    # 确定 header 行索引
    # 【逻辑分块】Step 1: 确定 header 策略
    header_row = 0
    if use_custom_header and header_columns:
        # 使用自定义列名时，header 行不作为列名
        # 设置为 -1 表示没有 header 行，数据从第一行开始
        header_row = -1

    # 加载文件数据
    # 【关键数据流】调用 load_file_data 获取 DataFrame
    df = load_file_data(source_file_path, sheet_name, header_row)

    # 应用自定义列名
    # 【副作用】修改 DataFrame 的列名
    if use_custom_header and header_columns and header_row == -1:
        df.columns = header_columns

    # 调用统一校验服务执行校验
    # 【核心逻辑】将参数传递给 UnifiedValidationService
    return UnifiedValidationService.validate(validation_type, df, target_column_name, **validation_config)


def load_file_data_with_settings(
    source_file_path: str,
    sheet_name: Optional[str] = None,
    header_row: int = 0,
    settings: Optional["FileProcessingSettings"] = None,
    source_config: Optional[dict[str, Any]] = None,
) -> pd.DataFrame:
    """
    @methoddesc 基于配置加载数据文件

    该函数是 load_file_data 的增强版本，支持通过 FileProcessingSettings 配置
    文件处理的各种参数，如编码检测、分隔符选择、空值处理策略等。

    支持的文件格式：
    - Excel (.xlsx, .xls): 支持多工作表
    - CSV (.csv): 支持自定义分隔符和编码
    - JSON (.json): 支持对象数组和嵌套对象
    - JSON Lines (.jsonl): 支持大文件流式读取

    参数:
        source_file_path: 源文件路径
        sheet_name: Excel 工作表名称（可选）
        header_row: 用作列名的行索引
        settings: 文件处理配置对象（可选），包含编码、分隔符等设置
        source_config: 数据源配置字典（可选），用于 JSON 等格式的高级配置
            - format: JSON 格式类型 (auto/array/lines/object)
            - json_path: JSONPath 提取路径
            - record_path: 嵌套数组展平路径
            - meta_prefix: 元数据字段前缀
            - sep: 嵌套对象展平分隔符
            - dtype: 列类型指定
            - flatten: 是否自动扁平化嵌套结构

    返回:
        清洗后的 pandas DataFrame 对象

    异常:
        FileNotFoundError: 文件不存在
        ValueError: 不支持的文件类型
    """
    # 文件存在性检查
    # 【副作用】文件不存在时抛出 FileNotFoundError
    if not os.path.exists(source_file_path):
        raise FileNotFoundError(f"文件不存在: {source_file_path}")

    from app.shared.core.data_source.loaders import load_source_data
    from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
    from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
    from app.shared.core.data_source.specs.json_source import JSONSourceSpec

    file_ext = os.path.splitext(source_file_path)[1].lower()
    sc = source_config or {}

    # 从 settings 中提取编码和分隔符配置
    # 【默认值策略】编码默认 utf-8，分隔符默认逗号
    # 当 settings 中配置为 "auto" 时，回退到默认值
    encoding = "utf-8"
    delimiter = ","
    if settings:
        encoding = settings.default_encoding if settings.default_encoding != "auto" else "utf-8"
        delimiter = settings.csv_delimiter if settings.csv_delimiter != "auto" else ","

    # 处理无表头模式（header_row=-1 表示没有表头行）
    header_enabled = header_row >= 0
    effective_header_row = header_row if header_row >= 0 else 0

    if file_ext in [".xlsx", ".xls"]:
        spec = ExcelSourceSpec(
            path=source_file_path,
            sheet=sheet_name,
            header_row=effective_header_row,
            header_enabled=header_enabled,
        )
    elif file_ext == ".csv":
        spec = CSVSourceSpec(
            path=source_file_path,
            header_row=effective_header_row,
            header_enabled=header_enabled,
            encoding=encoding,
            delimiter=delimiter,
        )
    elif file_ext in [".json", ".jsonl"]:
        fmt = sc.get("format", "auto")
        if file_ext == ".jsonl":
            fmt = "lines"
        spec = JSONSourceSpec(
            path=source_file_path,
            header_row=effective_header_row,
            header_enabled=header_enabled,
            format=fmt,
            json_path=sc.get("json_path"),
            record_path=sc.get("record_path"),
            meta_prefix=sc.get("meta_prefix", "meta."),
            sep=sc.get("sep", "."),
            dtype=sc.get("dtype"),
            flatten=sc.get("flatten", True),
        )
    else:
        raise ValueError(f"不支持的文件类型: {file_ext}")

    df = load_source_data(spec)
    # 数据清洗：将 NaN 统一转换为 None，保持数据一致性
    # 【副作用】统一空值表示，便于后续校验逻辑处理
    df = df.where(pd.notnull(df), None)
    return df


def validate_with_settings(
    validation_type: str, df: pd.DataFrame, column: str, settings: Optional["ValidationSettings"] = None, **kwargs
) -> ValidationResult:
    """
    @methoddesc 基于配置执行数据校验

    该函数接收已加载的 DataFrame 和校验配置，执行相应的校验逻辑。
    支持通过 ValidationSettings 配置脚本安全模式等高级选项。

    参数:
        validation_type: 校验类型，对应 ValidationType 中的常量
        df: 已加载的 pandas DataFrame
        column: 待校验的列名
        settings: 校验配置对象（可选），包含安全设置等
        **kwargs: 其他传递给验证器的参数

    返回:
        ValidationResult: 校验结果对象
    """
    # 获取对应类型的验证器
    # 【关键路由】通过 UnifiedValidationService 获取校验器
    validator = UnifiedValidationService.get_validator(validation_type)

    # 验证器不存在时，返回错误结果
    # 【副作用】返回错误结果对象
    if not validator:
        return ValidationResult(
            is_valid=False,
            error_count=1,
            total_rows=len(df),
            error_rows=[{"row_index": 0, "cell_value": None, "error_message": f"不支持的校验类型: {validation_type}"}],
            validation_time="0.000s",
        )

    # 处理脚本安全配置
    # 【逻辑分块】Step: 处理安全设置
    # 当 settings 中配置了 script_security 且 kwargs 未显式传入 allow_unsafe_eval 时，
    # 根据 script_security 的配置自动推导 allow_unsafe_eval 值
    if settings:
        if "allow_unsafe_eval" not in kwargs:
            if hasattr(settings, "script_security") and settings.script_security:
                ss = settings.script_security
                # 允许 eval 且不在沙箱模式时，视为允许不安全执行
                allow_unsafe_eval = ss.allow_eval and not ss.sandbox_mode
                kwargs["allow_unsafe_eval"] = allow_unsafe_eval

    # 执行校验并返回结果
    # 【核心逻辑】调用校验器的 validate 方法
    return validator.validate(df, column, **kwargs)
