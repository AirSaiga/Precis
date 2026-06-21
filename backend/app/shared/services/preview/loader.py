"""
@fileoverview 预览专用数据加载器模块

功能概述:
- 预览场景专用数据加载入口
- 使用新版 Spec + load_source_data 架构
- header_enabled=False（预览不识别表头，对应旧版 header=None）
- nrows 在加载时限制（CSV/Excel）
- 不做空值清洗，保持原始值供 str() 转换

架构设计:
- 职责隔离：preview 有独立入口，不触碰 validation/loader.py
- 直接利用新版架构（Spec → Loader → Registry），符合项目 V2 方向
- 为后续扩展（encoding、delimiter 预览参数）提供清晰位置

输入示例:
    df, sheet_names = load_preview_data(
        file_path="data/users.xlsx",
        file_type="excel",
        max_rows=100,
        sheet_name="Sheet1"
    )

输出示例:
    (DataFrame, sheet_names)
    - sheet_names 仅在 excel 时返回，其他格式为 None
"""

from __future__ import annotations

import logging

import pandas as pd

from app.shared.core.data_source.loaders import load_source_data
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
from app.shared.core.data_source.specs.json_source import JSONSourceSpec

logger = logging.getLogger(__name__)


def load_preview_data(
    file_path: str,
    file_type: str,
    max_rows: int,
    sheet_name: str | None = None,
    source_config: dict | None = None,
) -> tuple[pd.DataFrame, list[str] | None]:
    """
    @methoddesc 预览专用数据加载器

    使用新版 Spec + load_source_data 架构加载预览数据。
    - Excel/CSV：在加载时限制 nrows，不做空值清洗，保持原始数据供前端展示
    - JSON：复用 JSONSourceSpec 加载（无 nrows 字段，加载后按 max_rows 截断）

    参数:
        file_path: 待加载文件的完整路径
        file_type: 文件类型，可选值为 "excel" / "csv" / "json"
        max_rows: 最大读取行数，用于限制预览数据量
        sheet_name: Excel 工作表名称（仅 Excel 格式有效，可选）
        source_config: 额外的源配置字典，如编码(encoding)、分隔符(delimiter)

    返回:
        元组 (DataFrame, sheet_names)
        - DataFrame: 加载的原始数据（未清洗，保留空值和原始格式）
        - sheet_names: 仅在 Excel 格式时返回工作表名称列表，其他格式返回 None

    异常:
        ValueError: 当 file_type 为不支持的类型时抛出
        FileNotFoundError: 当文件不存在时抛出
    """
    # ======== Excel 格式处理 ========
    if file_type == "excel":
        # 构造 Excel 数据源规格，关闭表头识别、限制读取行数
        spec = ExcelSourceSpec(
            path=file_path,
            sheet=sheet_name,
            header_enabled=False,
            nrows=max_rows,
        )
        df = load_source_data(spec)

        # 额外打开 Excel 文件以获取所有工作表名称，供前端切换展示
        excel_file = pd.ExcelFile(file_path, engine="openpyxl")
        sheet_names = excel_file.sheet_names
        excel_file.close()

        return df, sheet_names

    # ======== CSV 格式处理 ========
    if file_type == "csv":
        # 从 source_config 提取编码和分隔符，使用默认值兜底
        sc = source_config or {}
        spec = CSVSourceSpec(
            path=file_path,
            header_enabled=False,
            nrows=max_rows,
            encoding=sc.get("encoding", "utf-8"),
            delimiter=sc.get("delimiter", ","),
        )
        df = load_source_data(spec)
        return df, None

    # ======== JSON 格式处理（复用 JSONSourceSpec + load_source_data 管线） ========
    if file_type == "json":
        # 从 source_config 提取 JSON 格式与 json_path，默认走自动检测
        sc = source_config or {}
        spec = JSONSourceSpec(
            path=file_path,
            format=sc.get("json_format", "auto"),
            json_path=sc.get("json_path"),
        )
        df = load_source_data(spec)
        # JSONSourceSpec 无 nrows 字段，加载后截断到预览行数上限
        if len(df) > max_rows:
            df = df.head(max_rows)
        return df, None

    # 如果走到这里，说明传入的文件类型不在支持列表中
    raise ValueError(f"不支持的文件类型: {file_type}")
