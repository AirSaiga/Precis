"""
@fileoverview 数据源加载模块

功能概述:
- 提供 Excel/CSV/JSON 文件的统一加载入口
- 实现线程安全的文件级缓存机制，避免重复读取磁盘
- 支持按文件分组批量加载多个数据源规格
- 提供缓存清除和加载能力检测工具函数

架构设计:
- 使用装饰器模式实现缓存（@synchronized_and_cached_by_filepath）
- 全局缓存字典 _data_cache 配合 FIFO 淘汰策略
- 全局锁字典 _file_locks 实现文件级别的并发控制
- 双检锁模式（double-check locking）提高并发性能

输入示例:
    file_to_schemas = {
        "data/users.xlsx": [excel_spec1, excel_spec2],
        "data/products.csv": [csv_spec]
    }

输出示例:
    datasets, errors = load_grouped_sources(file_to_schemas)
    # datasets: {"data/users.xlsx": pd.DataFrame, ...}
    # errors: ["data/products.csv: 文件不存在", ...]
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pandas as pd

from app.shared.core.data_source.loaders.base import DataLoadError
from app.shared.core.data_source.loaders.csv_loader import CSVLoader
from app.shared.core.data_source.loaders.excel_loader import ExcelLoader
from app.shared.core.data_source.loaders.json_loader import JSONLoader
from app.shared.core.data_source.specs.csv_source import CSVSourceSpec
from app.shared.core.data_source.specs.excel_source import ExcelSourceSpec
from app.shared.core.data_source.specs.json_source import JSONSourceSpec

if TYPE_CHECKING:
    from app.shared.domain import TableSchema


logger = logging.getLogger(__name__)


_data_cache: dict[str, Any] = {}

_MAX_CACHE_ENTRIES = 32

_file_locks: dict[str, threading.Lock] = {}

_lock_for_locks = threading.Lock()


def clear_cache() -> int:
    """
    @methoddesc 清除全局数据缓存，释放内存。

    注意：不会清除 _file_locks，防止正在进行中的加载操作丢失锁引用。

    :return: 清除前缓存中的条目数
    """
    with _lock_for_locks:
        count = len(_data_cache)
        _data_cache.clear()
        logger.debug(f"[Cache Clear] 已清除 {count} 个缓存条目。")
        return count


def _get_or_load(filepath: str, load_fn) -> Any:
    """
    @methoddesc 带缓存和线程安全的数据加载。

    实现双检锁模式（Double-Check Locking），确保同一文件在并发环境下只被加载一次：
    1. 先无锁检查缓存，命中则直接返回（性能最优路径）
    2. 未命中则获取该文件专属锁
    3. 持锁后再次检查缓存（防止等待期间其他线程已加载）
    4. 仍未命中则执行加载函数，并将结果存入缓存
    5. 缓存满时按 FIFO 策略淘汰最早条目

    Args:
        filepath: 文件的完整路径，同时作为缓存的键
        load_fn: 实际执行加载的回调函数（无参数）

    Returns:
        加载后的数据对象

    示例:
        >>> def load_csv():
        ...     return pd.read_csv("data.csv")
        >>> df = _get_or_load("data.csv", load_csv)
    """
    cache_key = filepath

    if cache_key in _data_cache:
        logger.debug(f"[Cache Hit] 直接从缓存返回 '{os.path.basename(filepath)}' 的数据。")
        return _data_cache[cache_key]

    with _lock_for_locks:
        if filepath not in _file_locks:
            _file_locks[filepath] = threading.Lock()
        file_lock = _file_locks[filepath]

    with file_lock:
        if cache_key in _data_cache:
            logger.debug(f"[Cache Hit after Lock] 从缓存返回 '{os.path.basename(filepath)}' 的数据。")
            return _data_cache[cache_key]

        logger.debug(f"[Cache Miss] 缓存未命中，准备从磁盘加载 '{os.path.basename(filepath)}'...")
        result = load_fn()

        while len(_data_cache) >= _MAX_CACHE_ENTRIES:
            oldest_key = next(iter(_data_cache))
            evicted = _data_cache.pop(oldest_key, None)
            # 注意：仅驱逐缓存数据，不清除 _file_locks
            # 原因：其他线程可能正在持有该文件的锁进行加载，
            # 清除锁会导致新线程创建新锁，破坏互斥保证
            if evicted is not None:
                logger.debug(f"[Cache Evict] 缓存已满，淘汰最早条目 '{os.path.basename(oldest_key)}'。")

        _data_cache[cache_key] = result
        logger.debug(f"[Cache Stored] 已缓存 '{os.path.basename(filepath)}' 的数据。")

        return result


def _load_excel_with_new_loader(filepath: str, schemas: list[TableSchema]) -> dict[str, pd.DataFrame]:
    """
    @methoddesc 使用新版 ExcelLoader 加载 Excel 文件（支持多 sheet）。

    将 TableSchema 列表转换为 sheet 配置字典，
    调用 ExcelLoader.load_multi_sheet() 实现一次性加载多个 sheet。

    Args:
        filepath: Excel 文件的完整路径
        schemas: 引用该文件的 schema 列表，每个 schema 包含 sheet 名称和表头行号等配置

    Returns:
        字典，键为 schema_id，值为对应的 DataFrame
        如果 schemas 中没有有效的 sheet 配置，返回空字典

    示例:
        >>> schemas = [TableSchema(id="users", sheet_name="Sheet1", header_row=0)]
        >>> result = _load_excel_with_new_loader("data.xlsx", schemas)
        >>> # result: {"users": DataFrame}
    """
    spec = ExcelSourceSpec(path=filepath)
    loader = ExcelLoader(spec)
    sheet_configs = {
        s.id: {
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


def _load_csv_with_new_loader(filepath: str, schemas: list[TableSchema]) -> dict[str, pd.DataFrame]:
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
        >>> schemas = [TableSchema(id="orders", header_row=0)]
        >>> result = _load_csv_with_new_loader("data.csv", schemas)
        >>> # result: {"orders": DataFrame}
    """
    if len(schemas) != 1:
        logger.warning(f"CSV 文件 '{os.path.basename(filepath)}' 被多个 Schema 引用，这不被支持。跳过。")
        return {}

    schema = schemas[0]
    spec = CSVSourceSpec(
        path=filepath,
        header_row=schema.header_row,
        encoding="utf-8",
    )
    loader = CSVLoader(spec)
    df = loader.load()
    return {schema.id: df}


def _load_json_with_new_loader(filepath: str, schemas: list[TableSchema]) -> dict[str, pd.DataFrame]:
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
        >>> schemas = [TableSchema(id="users", source_config={"format": "auto", "json_path": "$.data"})]
        >>> result = _load_json_with_new_loader("data.json", schemas)
        >>> # result: {"users": DataFrame}
    """
    if len(schemas) > 1:
        logger.warning(f"JSON 文件 '{os.path.basename(filepath)}' 被多个 Schema 引用，只处理第一个。")

    schema = schemas[0]
    source_config = getattr(schema, "source_config", None) or {}

    spec = JSONSourceSpec(
        path=filepath,
        json_format=source_config.get("format", "auto"),
        json_path=source_config.get("json_path"),
        flatten=source_config.get("flatten", True),
        sep=source_config.get("sep", "."),
    )
    loader = JSONLoader(spec)
    df = loader.load()
    return {schema.id: df}


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
    file_to_schemas: dict[str, list[TableSchema]],
    *,
    default_encoding: str = "utf-8",
    csv_delimiter: str = ",",
    file_to_sheet_names: dict[str, str] | None = None,
) -> tuple[dict[str, pd.DataFrame], list[dict[str, Any]]]:
    """
    @methoddesc 批量加载多个数据源文件。

    使用新版类式加载器（CSVLoader, ExcelLoader, JSONLoader），
    通过全局缓存机制避免重复加载。

    :param file_to_schemas: 字典，键为文件路径，值为对应的 schema 列表
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

            def _load(fp=full_path, fn=loader_fn, schemas=schemas_for_file):
                return fn(fp, schemas)

            file_datasets = _get_or_load(full_path, _load)
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
