"""
@fileoverview 数据源加载器模块

功能概述:
- 提供统一的数据源加载入口 load_source_data
- 根据数据源类型自动匹配对应的加载器类
- 支持 JSON、CSV、Excel、SQL 等多种数据源类型
- 封装加载器注册表的查询和实例化逻辑

架构设计:
- 加载器继承自 DataSourceLoader 抽象基类
- 通过 LOADER_REGISTRY 注册表实现加载器发现
- 支持按 source_type 字符串动态获取加载器类
- 加载失败时统一抛出 DataLoadError 异常

输入示例:
    >>> from app.shared.core.data_source.specs.json_source import JSONSourceSpec
    >>> spec = JSONSourceSpec(path="data/users.json", format="auto")

输出示例:
    >>> from app.shared.core.data_source.loaders import load_source_data
    >>> df = load_source_data(spec)
    >>> print(df.head())
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from .base import DataLoadError, DataSourceLoader
from .registry import LOADER_REGISTRY, get_loader_for_spec, register_loader, supports_source_type


def load_source_data(spec: Any) -> pd.DataFrame:
    """
    @methoddesc 统一的数据源加载入口

    ============================================================================
    功能说明
    ============================================================================
    根据数据源配置（spec）自动选择合适的加载器并加载数据。
    这是推荐的数据加载接口，屏蔽了不同数据源类型之间的差异。

    ============================================================================
    支持的数据源类型
    ============================================================================
    - JSON: JSONSourceSpec → JSONLoader
    - CSV: CSVSourceSpec → CSVLoader
    - Excel: ExcelSourceSpec → ExcelLoader
    - SQL: SQLSourceSpec → SQLLoader

    ============================================================================
    使用示例
    ============================================================================
    >>> from app.shared.core.data_source.loaders import load_source_data
    >>> from app.shared.core.data_source.specs.json_source import JSONSourceSpec
    >>>
    >>> spec = JSONSourceSpec(path="data/users.json", format="auto")
    >>> df = load_source_data(spec)
    >>> print(df.head())

    ============================================================================
    错误处理
    ============================================================================
    如果加载失败，会抛出 DataLoadError 异常，包含详细的错误信息。
    调用方应该捕获该异常并提供适当的错误处理。

    Args:
        spec: 数据源配置对象（必须是 DataSourceSpec 的子类）

    Returns:
        加载的 DataFrame

    Raises:
        DataLoadError: 加载失败时抛出
        TypeError: spec 类型不支持时抛出
    """
    if not hasattr(spec, "type"):
        raise TypeError("spec 必须包含 'type' 属性")

    try:
        loader_class = get_loader_for_source_type(spec.type)
    except TypeError:
        raise TypeError(f"不支持的数据源类型: {spec.type}")

    loader = loader_class(spec)
    return loader.load()


def get_loader_for_source_type(source_type: str) -> type[DataSourceLoader]:
    """
    @methoddesc 根据数据源类型获取对应的加载器类

    Args:
        source_type: 数据源类型（如 "json", "csv", "excel"）

    Returns:
        加载器类

    Raises:
        TypeError: 不支持的数据源类型
    """
    loader_class = LOADER_REGISTRY.get(source_type)
    if not loader_class:
        raise TypeError(f"不支持的数据源类型: {source_type}")
    return loader_class


def register_loader_for_type(source_type: str, loader_class: type[DataSourceLoader]) -> None:
    """
    @methoddesc 注册数据源类型到加载器的映射。

    与 loaders.registry.register_loader_class 功能相同，
    但操作的是 __init__ 模块中的 LOADER_REGISTRY。

    Args:
        source_type: 数据源类型标识（如 "json", "csv"）
        loader_class: 要注册的加载器类

    Returns:
        None

    示例:
        >>> register_loader_for_type("parquet", ParquetLoader)
    """
    LOADER_REGISTRY[source_type] = loader_class


def get_supported_types() -> list:
    """
    @methoddesc 获取所有支持的数据源类型

    Returns:
        支持的数据源类型列表
    """
    return list(LOADER_REGISTRY.keys())


def can_load_type(source_type: str) -> bool:
    """
    @methoddesc 检查是否支持指定的数据源类型

    Args:
        source_type: 数据源类型

    Returns:
        是否支持
    """
    return source_type in LOADER_REGISTRY


def validate_source_spec(spec: Any) -> bool:
    """
    @methoddesc 验证数据源配置是否有效

    Args:
        spec: 数据源配置对象

    Returns:
        配置是否有效

    Raises:
        ValueError: 配置无效时抛出
    """
    if not hasattr(spec, "type"):
        raise ValueError("spec 必须包含 'type' 属性")

    if not can_load_type(spec.type):
        raise ValueError(f"不支持的数据源类型: {spec.type}")

    if hasattr(spec, "path") and spec.path:
        from pathlib import Path

        if not Path(spec.path).exists():
            raise ValueError(f"数据源文件不存在: {spec.path}")

    return True


def load_source_data_safe(spec: Any) -> tuple[pd.DataFrame, list]:
    """
    @methoddesc 安全的数据源加载入口

    与 load_source_data 不同，此函数不会抛出异常，
    而是返回 (DataFrame, errors) 元组。

    Args:
        spec: 数据源配置对象

    Returns:
        (DataFrame, errors) 元组
        - DataFrame: 加载的数据
        - errors: 错误信息列表
    """
    try:
        df = load_source_data(spec)
        return df, []
    except Exception as e:
        return pd.DataFrame(), [str(e)]


def load_multiple_sources(specs: list) -> dict[str, pd.DataFrame]:
    """
    @methoddesc 批量加载多个数据源

    Args:
        specs: 数据源配置对象列表

    Returns:
        数据源名称到 DataFrame 的映射

    示例:
        >>> specs = [
        ...     JSONSourceSpec(path="data/users.json"),
        ...     CSVSourceSpec(path="data/orders.csv"),
        ... ]
        >>> datasets = load_multiple_sources(specs)
    """
    result = {}
    for i, spec in enumerate(specs):
        try:
            df = load_source_data(spec)
            name = getattr(spec, "name", None) or f"source_{i}"
            result[name] = df
        except Exception:
            continue
    return result


# 延迟导入具体加载器，避免循环依赖
def __getattr__(name):
    if name == "ExcelLoader":
        from .excel_loader import ExcelLoader

        return ExcelLoader
    elif name == "CSVLoader":
        from .csv_loader import CSVLoader

        return CSVLoader
    elif name == "JSONLoader":
        from .json_loader import JSONLoader

        return JSONLoader
    elif name == "SQLLoader":
        from .sql_loader import SQLLoader

        return SQLLoader
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


__all__ = [
    # 基类
    "DataSourceLoader",
    "DataLoadError",
    "register_loader",
    # 注册表
    "LOADER_REGISTRY",
    "get_loader_for_spec",
    "supports_source_type",
    # 统一加载接口
    "load_source_data",
    "load_source_data_safe",
    "load_multiple_sources",
    "get_loader_for_source_type",
    "register_loader_for_type",
    "get_supported_types",
    "can_load_type",
    "validate_source_spec",
    # 具体加载器（延迟加载）
    "ExcelLoader",
    "CSVLoader",
    "JSONLoader",
    "SQLLoader",
]
