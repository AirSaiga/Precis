"""
@fileoverview 数据源加载模块

功能概述:
- 提供 Excel/CSV/JSON 文件的统一加载入口
- 支持按文件分组批量加载多个数据源规格
- 提供加载能力检测工具函数

架构设计:
- 使用类式加载器（CSVLoader, ExcelLoader, JSONLoader）
- 每次调用均从磁盘读取最新数据，不使用缓存
- core 层只依赖 DataSourceInfo DTO，不直接依赖 domain.TableSchema

输入示例:
    file_to_schemas = {
        "data/users.xlsx": [DataSourceInfo(schema_id="users", sheet_name="Sheet1", header_row=0)],
        "data/products.csv": [DataSourceInfo(schema_id="products", header_row=0)]
    }

输出示例:
    datasets, errors = load_grouped_sources(file_to_schemas)
    # datasets: {"users": pd.DataFrame, ...}
    # errors: ["data/products.csv: 文件不存在", ...]
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import pandas as pd

from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.csv_loader import CSVLoader
from app.shared.core.data_source.loaders.excel_loader import ExcelLoader
from app.shared.core.data_source.loaders.json_loader import JSONLoader
from app.shared.core.data_source.schema_info import DataSourceInfo
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
from app.shared.core.data_source.specs.json_source import JSONSourceSpec

logger = logging.getLogger(__name__)


def _load_excel_with_new_loader(filepath: str, schemas: list[DataSourceInfo]) -> dict[str, pd.DataFrame]:
    """
    @methoddesc 使用新版 ExcelLoader 加载 Excel 文件（支持多 sheet）。

    将 DataSourceInfo 列表转换为 sheet 配置字典，
    调用 ExcelLoader.load_multi_sheet() 实现一次性加载多个 sheet。

    Args:
        filepath: Excel 文件的完整路径
        schemas: 引用该文件的 schema 列表，每个 schema 包含 sheet 名称和表头行号等配置

    Returns:
        字典，键为 schema_id，值为对应的 DataFrame
        如果 schemas 中没有有效的 sheet 配置，返回空字典

    示例:
        >>> schemas = [DataSourceInfo(schema_id="users", sheet_name="Sheet1", header_row=0)]
        >>> result = _load_excel_with_new_loader("data.xlsx", schemas)
        >>> # result: {"users": DataFrame}
    """
    spec = ExcelSourceSpec(path=filepath)
    loader = ExcelLoader(spec)
    sheet_configs = {
        s.schema_id: {
            "sheet_name": s.sheet_name,
            "header_row": s.header_row,
            "dtype_inference": s.source_config.get("dtype_inference", True),
            "skip_rows": s.source_config.get("skip_rows", 0),
            "nrows": s.source_config.get("nrows"),
        }
        for s in schemas
        if s.sheet_name
    }
    if not sheet_configs:
        return {}
    return loader.load_multi_sheet(sheet_configs)


def _load_csv_with_new_loader(filepath: str, schemas: list[DataSourceInfo]) -> dict[str, pd.DataFrame]:
    """
    @methoddesc 使用新版 CSVLoader 加载 CSV 文件。

    CSV 文件通常只对应一个 schema，因此只处理 schemas 列表中的第一个 schema。
    如果多个 schema 引用同一个 CSV 文件，会发出警告并跳过。

    Args:
        filepath: CSV 文件的完整路径
        schemas: 引用该文件的 schema 列表（期望长度为 1）

    Returns:
        字典，键为 schema_id，值为对应的 DataFrame
        如果 schemas 数量不为 1，返回空字典

    示例:
        >>> schemas = [DataSourceInfo(schema_id="orders", header_row=0)]
        >>> result = _load_csv_with_new_loader("data.csv", schemas)
        >>> # result: {"orders": DataFrame}
    """
    if len(schemas) != 1:
        logger.warning(f"CSV 文件 '{os.path.basename(filepath)}' 被多个 Schema 引用，这不被支持。跳过。")
        return {}

    info = schemas[0]
    spec = CSVSourceSpec(
        path=filepath,
        header_row=info.header_row,
        encoding="utf-8",
    )
    loader = CSVLoader(spec)
    df = loader.load()
    return {info.schema_id: df}


def _load_json_with_new_loader(filepath: str, schemas: list[DataSourceInfo]) -> dict[str, pd.DataFrame]:
    """
    @methoddesc 使用新版 JSONLoader 加载 JSON 文件。

    JSON 文件支持多个 schema 引用，但只处理第一个 schema 的配置。
    从 schema 的 source_config 中读取 format、json_path、flatten 等参数。

    Args:
        filepath: JSON 文件的完整路径
        schemas: 引用该文件的 schema 列表

    Returns:
        字典，键为 schema_id，值为对应的 DataFrame
        如果 schemas 为空，会抛出 IndexError（调用方应确保非空）

    示例:
        >>> schemas = [DataSourceInfo(schema_id="users", source_config={"format": "auto", "json_path": "$.data"})]
        >>> result = _load_json_with_new_loader("data.json", schemas)
        >>> # result: {"users": DataFrame}
    """
    if len(schemas) > 1:
        logger.warning(f"JSON 文件 '{os.path.basename(filepath)}' 被多个 Schema 引用，只处理第一个。")

    info = schemas[0]
    source_config = info.source_config or {}

    spec = JSONSourceSpec(
        path=filepath,
        format=source_config.get("format", "auto"),
        json_path=source_config.get("json_path"),
        record_path=source_config.get("record_path"),
        meta_prefix=source_config.get("meta_prefix", "meta."),
        sep=source_config.get("sep", "."),
        dtype=source_config.get("dtype"),
        flatten=source_config.get("flatten", False),
    )
    loader = JSONLoader(spec)
    df = loader.load()
    return {info.schema_id: df}


# 文件扩展名到加载函数的映射
# 每个扩展名对应一个私有加载函数，负责将文件路径和 schema 列表转换为 {schema_id: DataFrame}
_LOADER_FNS = {
    ".xlsx": _load_excel_with_new_loader,
    ".xls": _load_excel_with_new_loader,
    ".csv": _load_csv_with_new_loader,
    ".json": _load_json_with_new_loader,
    ".jsonl": _load_json_with_new_loader,
}

# 公开的加载器注册表，与 _LOADER_FNS 内容相同
# 供 can_load() 等函数查询支持的文件类型
LOADER_REGISTRY = dict(_LOADER_FNS)


def can_load(path: str) -> bool:
    """
    @methoddesc 检查指定路径的文件是否可以被加载。

    :param path: 文件路径（可以是完整路径或文件名）
    :return: 如果文件扩展名在 LOADER_REGISTRY 中返回 True，否则 False
    """
    ext = Path(path).suffix.lower()
    return ext in LOADER_REGISTRY


def load_grouped_sources(
    file_to_schemas: dict[str, list[DataSourceInfo]],
    *,
    default_encoding: str = "utf-8",
    csv_delimiter: str = ",",
    file_to_sheet_names: dict[str, str] | None = None,
) -> tuple[dict[str, pd.DataFrame], list[dict[str, Any]]]:
    """
    @methoddesc 批量加载多个数据源文件。

    使用新版类式加载器（CSVLoader, ExcelLoader, JSONLoader），
    通过全局缓存机制避免重复加载。

    :param file_to_schemas: 字典，键为文件路径，值为对应的 DataSourceInfo 列表
    :param default_encoding: CSV 文件的默认编码，默认为 "utf-8"
    :param csv_delimiter: CSV 文件的分隔符，默认为 ","
    :param file_to_sheet_names: 可选，字典，键为文件路径，值为 sheet 名称
    :return: 元组 (datasets, errors)
    """
    datasets: dict[str, pd.DataFrame] = {}
    errors: list[dict[str, Any]] = []

    for full_path, schemas_for_file in file_to_schemas.items():
        file_ext = os.path.splitext(full_path)[1].lower()

        if file_ext not in _LOADER_FNS:
            errors.append(
                {
                    "error_type": "UnsupportedFileType",
                    "message": f"源文件格式不被支持: {file_ext}。支持格式: {list(_LOADER_FNS.keys())}",
                    "source_path": full_path,
                }
            )
            continue

        if not os.path.exists(full_path):
            errors.append(
                {
                    "error_type": "FileNotFound",
                    "message": "源文件不存在",
                    "source_path": full_path,
                }
            )
            continue

        try:
            loader_fn = _LOADER_FNS[file_ext]
            logger.debug(f"[Load] 从磁盘加载 '{os.path.basename(full_path)}'...")
            file_datasets = loader_fn(full_path, schemas_for_file)
            datasets.update(file_datasets)

        except DataLoadError as e:
            errors.append(
                {
                    "error_type": "LoadFailed",
                    "message": str(e),
                    "source_path": full_path,
                }
            )
        except Exception as e:
            errors.append(
                {
                    "error_type": "LoadFailed",
                    "message": str(e),
                    "source_path": full_path,
                }
            )

    return datasets, errors
