"""
@fileoverview 数据源规范基类模块

功能概述:
- 提供所有数据源配置的抽象基类 DataSourceSpec
- 使用 Pydantic 进行配置验证和类型约束
- 支持多态反序列化（通过 discriminator 字段）
- 提供缓存、超时等通用配置字段

架构设计:
- 抽象基类模式（ABC + BaseModel）
- 子类必须设置 source_type 类属性并通过装饰器注册
- model_validator 自动校验 type 与 source_type 一致性
- 与 DataSourceLoader 形成规格-加载器配对关系

输入示例:
    @register_source_spec
    class JSONSourceSpec(FileSourceSpec):
        source_type: ClassVar[str] = "json"
        type: str = "json"
        path: str = "data.json"

输出示例:
    spec = DataSourceSpec.model_validate({"type": "json", "path": "data.json"})
    # 自动反序列化为 JSONSourceSpec 实例
    key = spec.get_connection_key()   # 返回连接标识（用于缓存）
"""

from __future__ import annotations

import builtins
from abc import ABC, abstractmethod
from typing import Any, ClassVar

from pydantic import BaseModel, Field, model_validator


class DataSourceSpec(BaseModel, ABC):
    """
    @classdesc 数据源规范抽象基类

    所有数据源配置（文件、数据库、API等）的基类。
    子类必须设置 source_type 类属性，并通过装饰器注册。

    属性说明:
        source_type: 类级别的类型标识，用于反序列化时识别类型
        type: 实例级别的类型字段，必须与 source_type 保持一致
        name: 数据源的显示名称（可选）
        description: 数据源的描述信息（可选）
        cache_enabled: 是否启用数据缓存，默认 True
        cache_ttl: 缓存有效期（秒），默认 300 秒（5分钟）
        timeout_seconds: 数据加载超时时间（秒），默认 30 秒

    示例:
        @register_source_spec
        class JSONSourceSpec(FileSourceSpec):
            source_type: ClassVar[str] = "json"
            type: str = "json"
            # ... 其他字段
    """

    # 类级别的类型标识，用于反序列化时识别类型
    source_type: ClassVar[str] = "abstract"

    # 实例级别的类型字段
    type: str = Field(..., description="数据源类型标识")

    # 通用字段（所有数据源都有）
    name: str | None = Field(None, description="数据源显示名称")
    description: str | None = Field(None, description="数据源描述")

    # 缓存和性能配置
    cache_enabled: bool = Field(True, description="是否启用缓存")
    cache_ttl: int = Field(300, ge=0, description="缓存有效期（秒）")

    # 超时配置
    timeout_seconds: int = Field(30, ge=1, description="加载超时时间（秒）")

    @model_validator(mode="after")
    def validate_type_match(self):
        """
        @methoddesc 验证实例类型与声明的 type 字段一致

        这是为了防止配置文件中声明的类型与实际类不匹配。
        例如：配置写 type="excel"，但实际解析成 CSVSourceSpec 就会报错。

        Raises:
            ValueError: 当 self.type 与 self.source_type 不一致时抛出

        Returns:
            验证通过后的实例自身（遵循 Pydantic 验证器约定）
        """
        if self.type != self.source_type:
            raise ValueError(f"类型不匹配: 声明为 '{self.type}'，但类定义为 '{self.source_type}'")
        return self

    @abstractmethod
    def get_connection_key(self) -> str:
        """
        @methoddesc 获取连接标识符（用于缓存键）

        每个数据源实例应有唯一的连接标识。
        例如：
        - 文件：绝对路径
        - 数据库：connection_url + table

        Returns:
            连接标识字符串，用于在缓存中唯一标识该数据源
        """
        pass

    @abstractmethod
    def get_loader_class(self) -> builtins.type[DataSourceLoader]:
        """
        @methoddesc 获取对应的加载器类

        子类需要返回对应的数据加载器类（如 CSVLoader、ExcelLoader 等）。
        采用延迟导入（在方法内部 import）以避免循环依赖。

        Returns:
            DataSourceLoader 的子类，负责实际的数据读取工作
        """
        pass

    def get_discriminator_value(self) -> str:
        """
        @methoddesc 获取类型标识符（用于加载器注册表）

        默认返回 source_type，子类可以覆盖。
        该值用于在反序列化时识别应该创建哪个子类的实例。

        Returns:
            类型标识字符串（如 "csv"、"excel"、"sql"）
        """
        return self.source_type

    def to_display_dict(self) -> dict[str, Any]:
        """
        @methoddesc 转换为显示用的字典（去除敏感信息）

        用于前端展示或日志记录，避免暴露密码等敏感字段。
        子类应通过 super().to_display_dict() 复用基类字段。

        Returns:
            包含安全字段的字典，至少包含 type、name、source_type
        """
        return {
            "type": self.type,
            "name": self.name,
            "source_type": self.source_type,
        }


# 用于 Pydantic 多态反序列化的类型映射
# 键是数据源类型标识（如 "csv"），值是对应的 Spec 类
# 通过 @register_source_spec 装饰器自动填充
SOURCE_SPEC_REGISTRY: dict[str, type[DataSourceSpec]] = {}


def register_source_spec(spec_class: type[DataSourceSpec]) -> type[DataSourceSpec]:
    """
    @methoddesc 装饰器：注册数据源规范类

    用法:
        @register_source_spec
        class JSONSourceSpec(FileSourceSpec):
            source_type = "json"
            ...

    注册后，该类型会被加入 SOURCE_SPEC_REGISTRY，
    从而支持通过 create_spec() 根据 type 字段自动创建对应实例。

    Args:
        spec_class: 数据源规范类，必须定义 source_type 类属性

    Returns:
        原类（装饰器模式，不改变类本身）

    Raises:
        ValueError: 如果类没有 source_type 属性，或 source_type 为 "abstract"
    """
    # 检查是否定义了 source_type 类属性
    if not hasattr(spec_class, "source_type"):
        raise ValueError(f"{spec_class.__name__} 必须定义 source_type 类属性")

    # 禁止将抽象基类注册到注册表
    if spec_class.source_type == "abstract":
        raise ValueError(f"{spec_class.__name__} 的 source_type 不能为 'abstract'")

    # 将类注册到全局字典中，键为 source_type 的值
    SOURCE_SPEC_REGISTRY[spec_class.source_type] = spec_class
    return spec_class


def get_spec_class(source_type: str) -> type[DataSourceSpec] | None:
    """
    @methoddesc 根据类型标识获取对应的 Spec 类

    用于在反序列化时查找对应的类，或判断某种类型是否被支持。

    Args:
        source_type: 数据源类型标识（如 "excel", "json", "csv", "sql"）

    Returns:
        Spec 类，或 None（如果该类型未注册）
    """
    return SOURCE_SPEC_REGISTRY.get(source_type)


def create_spec(source_dict: dict[str, Any]) -> DataSourceSpec:
    """
    @methoddesc 根据字典创建对应的 Spec 实例

    这是多态反序列化的入口：根据字典中的 "type" 字段，
    自动查找并实例化对应的 Spec 子类。

    Args:
        source_dict: 包含 type 字段的配置字典，其他字段取决于具体子类

    Returns:
        DataSourceSpec 子类的实例

    Raises:
        ValueError: 缺少 type 字段，或 type 对应的类型未注册
    """
    # 从字典中提取类型标识
    source_type = source_dict.get("type")
    if not source_type:
        raise ValueError("配置字典必须包含 'type' 字段")

    # 查找对应的数据源规格类
    spec_class = get_spec_class(source_type)
    if not spec_class:
        raise ValueError(f"未知的数据源类型: '{source_type}'。支持的类型: {list(SOURCE_SPEC_REGISTRY.keys())}")

    # 使用 Pydantic 模型解析字典，自动进行类型校验和转换
    return spec_class(**source_dict)


# 延迟导入，避免循环依赖
# DataSourceLoader 在加载时会引用 DataSourceSpec，
# 如果在这里顶层导入会导致循环导入问题
from ..loaders.base import DataSourceLoader
