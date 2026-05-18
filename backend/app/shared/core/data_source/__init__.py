"""
@fileoverview 数据源模块入口

功能概述:
- 提供统一的数据加载接口，支持多种数据源类型
- 导出所有数据源规格类（Excel、CSV、JSON、SQL）
- 导出加载器工具和缓存管理函数
- 作为 data_source 包的统一对外入口

架构设计:
- 通过 __init__.py 聚合子模块的公共接口
- 规格类继承自 DataSourceSpec 基类，支持多态反序列化
- 加载器通过注册表自动匹配数据源类型

输入示例:
    >>> from app.shared.core.data_source import JSONSourceSpec, load_grouped_sources
    >>> spec = JSONSourceSpec(
    ...     path="data.json",
    ...     format="auto",
    ...     json_path="$.data.items"
    ... )

输出示例:
    >>> df = load_grouped_sources({"data.json": [spec]})
    >>> # 返回 (datasets: dict, errors: list) 元组
"""

# 规格类
from .loader import (
    LOADER_REGISTRY,
    can_load,
    clear_cache,
    load_grouped_sources,
)

# 加载器
from .loaders import DataLoadError
from .specs import (
    CSVSourceSpec,
    CSVSpec,
    DataSourceSpec,
    ExcelSourceSpec,
    ExcelSpec,
    FileSourceSpec,
    JSONSourceSpec,
    JSONSpec,
    SQLSourceSpec,
)

__all__ = [
    # 基础类型
    "DataSourceSpec",
    "FileSourceSpec",
    # 具体规格
    "ExcelSpec",
    "CSVSpec",
    "JSONSpec",
    "ExcelSourceSpec",
    "CSVSourceSpec",
    "JSONSourceSpec",
    "SQLSourceSpec",
    # 加载器
    "DataLoadError",
    "load_grouped_sources",
    "clear_cache",
    "can_load",
    "LOADER_REGISTRY",
]
