r"""
@fileoverview 校验加载器模块

功能概述:
- 提供数据文件加载功能,支持 Excel、CSV、JSON、JSON Lines 格式
- 提供数据文件加载(load_file_data)，支持 FileProcessingSettings 配置
- 支持编码自动检测、CSV 自定义分隔符
- 支持 JSONPath 提取和嵌套 JSON 扁平化

架构设计:
- 文件加载层处理格式和编码,校验层(UnifiedValidationService/校验流水线)专注业务逻辑
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
    df = load_file_data("data/products.csv", settings=settings)

输出示例:
    # 返回 pandas DataFrame
    #    id  name  email
    # 0   1  张三  zhangsan@example.com
"""

import logging
import os
from typing import TYPE_CHECKING, Any, Optional

import pandas as pd

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.shared.core.project.manifest.types_parts.settings_file_processing import FileProcessingSettings


def load_file_data(
    source_file_path: str,
    sheet_name: str | None = None,
    header_row: int = 0,
    settings: Optional["FileProcessingSettings"] = None,
    source_config: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """
    @methoddesc 加载数据文件为基础 DataFrame

    读取指定路径的数据文件（Excel、CSV 或 JSON），并转换为 pandas DataFrame 进行处理。
    支持通过 source_config 传递高级配置（如 JSON 的 json_path、format 等），
    或通过 settings 对象传递编码/分隔符配置。

    支持的文件格式：
    - Excel (.xlsx, .xls): 使用 openpyxl 引擎，支持多 sheet
    - CSV (.csv): 默认 UTF-8 编码
    - JSON (.json): 支持对象数组和嵌套对象（自动扁平化）
    - JSON Lines (.jsonl, .ndjson): 每行一个 JSON 对象，适合大文件

    参数:
        source_file_path: 源文件路径
        sheet_name: Excel 工作表名称（可选）
        header_row: 用作列名的行索引，默认为 0
        settings: 文件处理配置对象（可选），优先级高于 source_config
        source_config: 数据源配置字典（可选）

    返回:
        转换后的 pandas DataFrame 对象，空值被统一处理为 None
    """
    if not os.path.exists(source_file_path):
        raise FileNotFoundError(f"文件不存在: {source_file_path}")

    from app.shared.core.data_source.loaders import load_source_data
    from app.shared.core.data_source.specs.base import DataSourceSpec
    from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
    from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
    from app.shared.core.data_source.specs.json_source import JSONSourceSpec

    spec: DataSourceSpec

    file_ext = os.path.splitext(source_file_path)[1].lower()
    sc = source_config or {}

    encoding = "utf-8"
    delimiter = ","
    if settings:
        encoding = settings.default_encoding if settings.default_encoding != "auto" else "utf-8"
        delimiter = settings.csv_delimiter if settings.csv_delimiter != "auto" else ","

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
            encoding=sc.get("encoding", encoding),
            delimiter=sc.get("delimiter", delimiter),
        )
    elif file_ext in [".json", ".jsonl", ".ndjson"]:
        # 前端使用 json_format 字段透传 JSON 解析格式，兼容 format 别名
        # D8: format 必填(auto 已废弃);.jsonl/.ndjson 强制 lines;其余由配置显式指定
        fmt = sc.get("format") or sc.get("json_format") or "array"
        if file_ext in [".jsonl", ".ndjson"]:
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
    df = df.where(pd.notnull(df), None)
    df = df.replace("", None)

    return df
