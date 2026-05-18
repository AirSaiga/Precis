"""
@fileoverview 数据源加载器基类模块

功能概述:
- 定义加载数据源的通用抽象接口
- 提供泛型基类支持类型安全的规格绑定
- 支持批量加载的默认实现（可被子类覆盖）
- 提供数据源配置验证接口

架构设计:
- 抽象基类模式（ABC + Generic[SpecType]）
- 子类只需实现 load 方法即可支持新数据源
- 支持迭代器形式的批量加载，便于处理大文件
- 与 DataSourceSpec 规格类形成一对一映射

输入示例:
    class JSONLoader(DataSourceLoader[JSONSourceSpec]):
        spec_class = JSONSourceSpec

        def load(self) -> pd.DataFrame:
            # 实现加载逻辑
            return pd.read_json(self.spec.path)

输出示例:
    loader = JSONLoader(spec)
    df = loader.load()           # 返回 pd.DataFrame
    batches = loader.load_batch(10000)  # 返回 Iterator[pd.DataFrame]
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Generic, TypeVar

import pandas as pd

# 类型变量，用于泛型
SpecType = TypeVar("SpecType", bound="DataSourceSpec")


class DataSourceLoader(ABC, Generic[SpecType]):
    """
    @classdesc 数据源加载器抽象基类

    定义加载数据源的通用接口。子类只需实现 load 方法即可支持新数据源。

    示例:
        class JSONLoader(DataSourceLoader[JSONSourceSpec]):
            spec_class = JSONSourceSpec

            def load(self) -> pd.DataFrame:
                # 实现加载逻辑
                return pd.read_json(self.spec.path)
    """

    # 类级别的规范类型，子类必须覆盖
    spec_class: type

    def __init__(self, spec: SpecType):
        """
        初始化加载器

        Args:
            spec: 数据源规范配置
        """
        self.spec = spec

    @abstractmethod
    def load(self) -> pd.DataFrame:
        """
        @methoddesc 加载数据并返回 DataFrame

        这是唯一需要子类实现的方法。

        Returns:
            加载的数据（pandas DataFrame）

        Raises:
            DataLoadError: 加载失败时抛出
        """
        pass

    def load_batch(self, batch_size: int = 10000) -> Iterator[pd.DataFrame]:
        """
        @methoddesc 批量加载数据（用于大文件）

        默认实现是单批次返回全部数据，
        子类可重写以实现真正的流式读取。

        Args:
            batch_size: 每批次的行数

        Returns:
            DataFrame 迭代器
        """
        yield self.load()

    def validate(self) -> list[str]:
        """
        @methoddesc 验证数据源配置是否正确（不实际加载数据）

        检查：
        - 文件是否存在（文件型）
        - 连接是否可达（连接型）
        - 权限是否足够

        Returns:
            错误信息列表（空列表表示验证通过）
        """
        return []

    def preview(self, nrows: int = 10) -> pd.DataFrame:
        """
        @methoddesc 预览前 n 行数据

        默认实现使用 load() 后截取，
        子类可重写以提高性能。

        Args:
            nrows: 预览行数

        Returns:
            预览数据
        """
        df = self.load()
        return df.head(nrows)

    def get_schema(self) -> dict[str, str]:
        """
        @methoddesc 获取数据源的 schema（列名和类型）

        用于前端展示和自动推断配置。

        Returns:
            字典，键为列名，值为类型字符串
        """
        df = self.preview(nrows=100)
        return {col: str(dtype) for col, dtype in df.dtypes.items()}


class DataLoadError(Exception):
    """
    @classdesc 数据加载异常

    当数据源加载过程中发生错误时抛出此异常。
    包含原始错误信息、数据源规格和根本原因，便于调试和错误报告。

    Attributes:
        spec: 发生错误的数据源规格对象（可选）
        cause: 原始异常对象（可选）

    示例:
        >>> raise DataLoadError("文件不存在", spec, original_exception)
    """

    def __init__(self, message: str, spec: DataSourceSpec | None = None, cause: Exception | None = None):
        """
        初始化数据加载异常

        Args:
            message: 错误描述信息
            spec: 发生错误的数据源规格对象（可选）
            cause: 导致此错误的原始异常（可选）
        """
        super().__init__(message)
        self.spec = spec
        self.cause = cause

    def __str__(self) -> str:
        """
        @methoddesc 生成格式化的错误信息字符串

        Returns:
            包含数据源类型和根本原因的完整错误信息
        """
        msg = super().__str__()
        if self.spec:
            msg = f"[{self.spec.type}] {msg}"
        if self.cause:
            msg = f"{msg} (原因: {self.cause})"
        return msg


class ValidationError(Exception):
    """
    @classdesc 数据验证异常

    当数据源配置验证失败时抛出此异常。
    用于在数据加载前检查配置合法性（如文件不存在、参数错误等）。

    示例:
        >>> raise ValidationError("连接字符串不能为空")
    """

    pass


# 延迟导入，避免循环依赖
from ..specs.base import DataSourceSpec
