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

import logging
from typing import Any

import pandas as pd

from .base import DataLoadError, DataSourceLoader
from .registry import LOADER_REGISTRY, register_loader

logger = logging.getLogger(__name__)


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
    # 统一加载接口
    "load_source_data",
    "load_source_data_safe",
    "get_loader_for_source_type",
    "get_supported_types",
    "can_load_type",
    # 具体加载器（延迟加载）
    "ExcelLoader",
    "CSVLoader",
    "JSONLoader",
    "SQLLoader",
]
