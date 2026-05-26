"""
@fileoverview 数据源模块统一入口

功能概述:
- 提供统一的数据加载接口，支持多种数据源类型（Excel、CSV、JSON、SQL）
- 导出所有数据源规格类，供上层服务和 API 路由构建数据源配置
- 导出加载器工具和缓存管理函数，实现数据的高效加载与复用
- 作为 app.shared.core.data_source 包的门面（Facade），封装内部子模块细节

架构设计:
- 门面模式: 通过 __init__.py 聚合 specs、loader、loaders 等子模块的公共接口，
  调用方只需导入本模块即可获得完整的数据源操作能力。
- 规格类继承体系: 所有具体规格类（ExcelSourceSpec、CSVSourceSpec 等）
  均继承自 DataSourceSpec 基类，支持多态反序列化和统一校验。
- 加载器注册表: LOADER_REGISTRY 维护数据源类型到加载器实现的映射，
  load_grouped_sources 根据规格自动分派到对应的加载器，实现开闭原则。

输入示例:
    >>> from app.shared.core.data_source import JSONSourceSpec, load_grouped_sources
    >>> spec = JSONSourceSpec(
    ...     path="data.json",
    ...     format="auto",
    ...     json_path="$.data.items"
    ... )

输出示例:
    >>> datasets, errors = load_grouped_sources({"data.json": [spec]})
    >>> # datasets: dict[str, pd.DataFrame] — 文件名到 DataFrame 的映射
    >>> # errors: list[DataLoadError] — 加载过程中收集的错误列表

注意事项:
- 新增数据源类型时，需在 specs 中定义规格类、在 loaders 中实现加载器，
  并在本模块重导出，同时更新 LOADER_REGISTRY 的映射关系。
- __all__ 显式控制公开 API，避免内部辅助函数被意外暴露。
"""

# 从 loader 子模块导入加载器注册表及工具函数
# LOADER_REGISTRY: 数据源类型到加载器类的映射表，支持运行时扩展
# load_grouped_sources: 批量加载入口，按文件分组并行处理
# clear_cache: 清除加载缓存，用于数据源文件变更后的热刷新
# can_load: 预检函数，判断给定规格是否可被当前注册表支持
from .loader import (
    LOADER_REGISTRY,
    can_load,
    clear_cache,
    load_grouped_sources,
)

# 从 loaders 子模块导入加载异常类型
# DataLoadError: 统一的数据加载异常，包含文件路径、错误原因等上下文信息
from .loaders import DataLoadError

# 从 specs 子模块导入所有数据源规格类
# DataSourceSpec / FileSourceSpec: 抽象基类，定义规格的通用接口
# ExcelSpec / CSVSpec / JSONSpec: 向后兼容的别名导出
# ExcelSourceSpec / CSVSourceSpec / JSONSourceSpec / SQLSourceSpec: 具体规格实现
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

# 控制 `from module import *` 时导出的公开名称
# 按类别分组：基础类型 → 具体规格 → 加载器工具，便于阅读和维护
__all__ = [
    # 基础类型
    "DataSourceSpec",
    "FileSourceSpec",
    # 具体规格（向后兼容别名 + 标准名称）
    "ExcelSpec",
    "CSVSpec",
    "JSONSpec",
    "ExcelSourceSpec",
    "CSVSourceSpec",
    "JSONSourceSpec",
    "SQLSourceSpec",
    # 加载器工具
    "DataLoadError",
    "load_grouped_sources",
    "clear_cache",
    "can_load",
    "LOADER_REGISTRY",
]
