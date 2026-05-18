"""
@fileoverview JSON 数据源规范模块

功能概述:
- 定义 JSON 文件的数据源规格类
- 支持多种 JSON 格式：对象数组、JSON Lines、嵌套对象
- 提供 JSONPath 提取和自动展平功能
- 支持流式读取大文件和嵌套深度控制

架构设计:
- 继承自 FileSourceSpec，复用文件通用配置
- 通过 @register_source_spec 装饰器自动注册到规格注册表
- 与 JSONLoader 配对使用，通过 format 字段选择解析策略
- model_validator 自动校验 json_path 格式和必要性

输入示例:
    # 对象数组
    spec = JSONSourceSpec(path="data/users.json", format="array")
    # 嵌套对象提取
    spec = JSONSourceSpec(
        path="data/api.json",
        format="object",
        json_path="$.data.items",
        sep="."
    )
    # JSON Lines
    spec = JSONSourceSpec(path="data/large.jsonl", format="lines")

输出示例:
    loader_class = spec.get_loader_class()   # 返回 JSONLoader
    display = spec.to_display_dict()
    # {"path": "data/api.json", "format": "object", "json_path": "$.data.items", ...}
"""

from __future__ import annotations

import builtins
from typing import TYPE_CHECKING, Any, ClassVar, Literal

if TYPE_CHECKING:
    from ..loaders.base import DataSourceLoader

from pydantic import Field, model_validator

from .base import register_source_spec
from .file_base import FileSourceSpec


@register_source_spec
class JSONSourceSpec(FileSourceSpec):
    """
    @classdesc JSON 数据源配置

    支持多种 JSON 格式：对象数组、JSON Lines、嵌套对象。
    提供 JSONPath 提取和自动展平功能，适应不同结构的 JSON 数据。

    特有配置:
        format: JSON 格式类型
            - auto: 自动检测格式
            - array: 对象数组（如 [{"id": 1}, {"id": 2}]）
            - lines: JSON Lines（每行一个 JSON 对象）
            - object: 嵌套对象（需要通过 json_path 提取数据）
        json_path: JSONPath 提取路径（如 "$.data.users"），用于从嵌套结构中提取数据
        record_path: 要展平的路径，用于将嵌套数组展开为行
        meta_prefix: 元数据字段前缀，用于区分展平时的元数据字段
        sep: 嵌套对象展平时的分隔符（如 "." 表示 "user.name"）
        dtype: 列类型指定，如 {"id": "str", "count": "int"}
        flatten: 是否自动扁平化嵌套结构（将嵌套对象展开为平面表格）
        max_depth: 扁平化时的最大递归深度，防止无限递归
        streaming_threshold_mb: 启用流式读取的阈值（MB），超过则分块读取
        chunk_size: 流式读取时的块大小（行数）

    示例:
        # 对象数组
        ```yaml
        source:
          type: json
          path: data/users.json
          format: array
        ```

        # 嵌套对象提取
        ```yaml
        source:
          type: json
          path: data/api_response.json
          format: object
          json_path: "$.data.items"
          sep: "."
        ```

        # JSON Lines
        ```yaml
        source:
          type: json
          path: data/large_file.jsonl
          format: lines
        ```
    """

    source_type: ClassVar[str] = "json"
    type: str = "json"

    # JSON 格式类型
    format: Literal["auto", "array", "lines", "object"] = Field(
        "auto", description="JSON 格式类型：auto-自动检测, array-对象数组, lines-JSON Lines, object-嵌套对象"
    )

    # 数据提取路径
    json_path: str | None = Field(None, description="JSONPath 提取路径，如 '$.data.items'（当 format=object 时必需）")

    # 展平配置
    record_path: str | None = Field(None, description="要展平的路径，如 'items'（用于数组字段展开为行）")
    meta_prefix: str = Field("meta.", description="元数据字段前缀（展平时用于区分原始字段和元数据字段）")
    sep: str = Field(".", description="嵌套对象展平时的分隔符（如 'user.name'）")

    # 类型推断
    dtype: dict[str, str] | None = Field(None, description="列类型指定，如 {'id': 'str', 'count': 'int'}")

    # 展平配置
    flatten: bool = Field(False, description="是否自动扁平化嵌套结构（将多层嵌套转为单层表格）")
    max_depth: int | None = Field(None, description="扁平化时的最大递归深度（None 表示不限制）")

    # 大文件处理
    streaming_threshold_mb: float = Field(50.0, ge=1.0, description="启用流式读取的阈值（MB），超过此大小将分块读取")
    chunk_size: int = Field(10000, ge=100, description="流式读取时的块大小（每次读取的行数）")

    @model_validator(mode="after")
    def validate_json_path(self):
        """
        @methoddesc 当 format=object 时，json_path 是必需的

        object 格式表示 JSON 是一个嵌套对象，需要通过 json_path 定位到数据数组。
        如果没有 json_path，加载器不知道从哪里提取数据。

        Raises:
            ValueError: 当 format="object" 但 json_path 为空时抛出

        Returns:
            验证通过后的实例自身
        """
        if self.format == "object" and not self.json_path:
            raise ValueError("当 format='object' 时，必须指定 json_path")
        return self

    @model_validator(mode="after")
    def validate_json_path_format(self):
        """
        @methoddesc 验证 json_path 格式

        JSONPath 必须以 "$.") 开头，这是 JSONPath 标准的根元素标识。
        例如 "$.data.items" 表示从根对象开始，访问 data 属性下的 items 属性。

        Raises:
            ValueError: 当 json_path 不以 "$." 开头时抛出

        Returns:
            验证通过后的实例自身
        """
        if self.json_path and not self.json_path.startswith("$."):
            raise ValueError(f"json_path 必须以 '$.') 开头，当前值: '{self.json_path}'")
        return self

    def get_loader_class(self) -> builtins.type[DataSourceLoader]:
        """
        @methoddesc 获取 JSON 数据加载器类

        延迟导入 JSONLoader，避免循环依赖。
        JSONLoader 根据 format 字段选择不同的解析策略。

        Returns:
            JSONLoader 类
        """
        from ..loaders.json_loader import JSONLoader

        return JSONLoader

    def to_display_dict(self) -> dict[str, Any]:
        """
        @methoddesc 转换为显示用的字典

        在基类的基础上增加 JSON 特有的展示字段。

        Returns:
            包含 format、json_path、sep 等 JSON 特有字段的字典
        """
        return {
            **super().to_display_dict(),
            "format": self.format,
            "json_path": self.json_path,
            "sep": self.sep,
        }
