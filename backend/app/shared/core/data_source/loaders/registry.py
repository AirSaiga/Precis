"""
@fileoverview 数据源加载器注册表模块

功能概述:
- 提供加载器的集中管理和发现机制
- 实现装饰器 register_loader 用于自动注册加载器类
- 支持按数据源类型获取加载器类或实例
- 提供加载器存在性检测功能

架构设计:
- 全局字典 LOADER_REGISTRY 存储类型到加载器类的映射
- 装饰器模式实现声明式注册
- 支持按 discriminator_value 精确匹配
- 与规格类的注册机制对称设计

输入示例:
    >>> @register_loader("json")
    ... class JSONLoader(DataSourceLoader[JSONSourceSpec]):
    ...     spec_class = JSONSourceSpec
    ...     def load(self) -> pd.DataFrame:
    ...         pass

输出示例:
    >>> loader_class = get_loader_class_for_type("json")
    >>> loader_instance = get_loader_for_spec(spec)
    >>> supports_source_type("csv")
    True
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..specs import DataSourceSpec
    from .base import DataSourceLoader


LOADER_REGISTRY: dict[str, type[DataSourceLoader]] = {}


def register_loader(spec_discriminator: str):
    """
    @methoddesc 装饰器：注册加载器到全局注册表

    Args:
        spec_discriminator: 数据源类型标识符，应与 Spec 类的 discriminator_value 一致

    示例:
        >>> @register_loader("json")
        ... class JSONLoader(DataSourceLoader[JSONSpec]):
        ...     pass
    """

    def decorator(loader_class: type[DataSourceLoader]) -> type[DataSourceLoader]:
        """
        @methoddesc 注册加载器类到全局注册表

        参数:
            loader_class: 要注册的加载器类，必须继承 DataSourceLoader

        返回:
            注册后的加载器类（便于装饰器链式使用）

        异常:
            ValueError: 如果该类型已注册则抛出
        """
        if spec_discriminator in LOADER_REGISTRY:
            raise ValueError(f"加载器 '{spec_discriminator}' 已注册")
        LOADER_REGISTRY[spec_discriminator] = loader_class
        return loader_class

    return decorator


def get_loader_for_spec(spec: DataSourceSpec) -> DataSourceLoader:
    """
    @methoddesc 根据规格对象获取对应的加载器实例

    Args:
        spec: 数据源规格对象

    Returns:
        对应的加载器实例

    Raises:
        ValueError: 找不到对应的加载器时抛出
    """
    discriminator = spec.get_discriminator_value()
    loader_class = LOADER_REGISTRY.get(discriminator)
    if not loader_class:
        raise ValueError(f"未找到数据源类型的加载器: {discriminator}")
    return loader_class(spec)


def get_loader_class_for_type(source_type: str) -> type[DataSourceLoader]:
    """
    @methoddesc 根据数据源类型字符串获取对应的加载器类

    Args:
        source_type: 数据源类型字符串（如 "json", "csv"）

    Returns:
        对应的加载器类

    Raises:
        KeyError: 找不到对应的加载器时抛出
    """
    loader_class = LOADER_REGISTRY.get(source_type)
    if not loader_class:
        raise KeyError(f"未找到数据源类型的加载器: {source_type}")
    return loader_class


def supports_source_type(discriminator: str) -> bool:
    """
    @methoddesc 检查是否支持指定的数据源类型

    Args:
        discriminator: 数据源类型标识符

    Returns:
        是否支持该类型
    """
    return discriminator in LOADER_REGISTRY


def get_supported_types() -> list[str]:
    """
    @methoddesc 获取所有支持的数据源类型

    Returns:
        支持的数据源类型列表
    """
    return list(LOADER_REGISTRY.keys())


def register_loader_class(source_type: str, loader_class: type[DataSourceLoader]) -> None:
    """
    @methoddesc 注册加载器类到注册表

    与 @register_loader 装饰器功能相同，但以函数调用方式注册。
    适用于动态注册或无法在类定义时使用装饰器的场景。

    Args:
        source_type: 数据源类型标识符（如 "csv", "json"）
        loader_class: 要注册的加载器类

    Returns:
        None

    示例:
        >>> register_loader_class("parquet", ParquetLoader)
    """
    LOADER_REGISTRY[source_type] = loader_class
