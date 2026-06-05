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
