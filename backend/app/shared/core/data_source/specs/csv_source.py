"""
@fileoverview CSV 数据源规范模块

功能概述:
- 定义 CSV 文件的数据源规格类
- 支持自定义分隔符、引号字符、转义字符
- 提供自动编码检测和编码回退机制
- 支持坏行处理策略（error/warn/skip）

架构设计:
- 继承自 FileSourceSpec，复用文件通用配置
- 通过 @register_source_spec 装饰器自动注册到规格注册表
- 与 CSVLoader 配对使用，实现 CSV 数据加载
- Pydantic Field 提供默认值和校验约束

输入示例:
    spec = CSVSourceSpec(
        path="data/users.csv",
        delimiter=",",
        quotechar='"',
        encoding="utf-8",
        encoding_detection=True,
        on_bad_lines="warn"
    )

输出示例:
    loader_class = spec.get_loader_class()   # 返回 CSVLoader
    display = spec.to_display_dict()
    # {"path": "data/users.csv", "delimiter": ",", "encoding": "utf-8", ...}
"""

from __future__ import annotations

import builtins
from typing import TYPE_CHECKING, Any, ClassVar, Literal

if TYPE_CHECKING:
    from ..loaders.base import DataSourceLoader

from pydantic import Field

from .base import register_source_spec
from .file_base import FileSourceSpec


@register_source_spec
class CSVSourceSpec(FileSourceSpec):
    """
    @classdesc CSV 数据源配置

    支持标准 CSV（逗号分隔值）文件，提供自动编码检测功能。
    CSV 是纯文本格式，每行是一条记录，字段之间用分隔符隔开。

    特有配置:
        delimiter: 字段分隔符（默认逗号），也可以是分号、制表符等
        quotechar: 引号字符（默认双引号），用于包裹包含分隔符的字段
        escapechar: 转义字符，用于转义引号等特殊字符
        encoding_detection: 是否自动检测编码（通过 chardet 等库）
        fallback_encodings: 编码检测失败时依次尝试的编码列表
        on_bad_lines: 遇到格式错误的行时的处理方式

    示例:
        ```yaml
        source:
          type: csv
          path: data/users.csv
          delimiter: ","
          encoding: utf-8
        ```
    """

    source_type: ClassVar[str] = "csv"
    type: str = "csv"

    # CSV 特有配置
    delimiter: str = Field(",", min_length=1, max_length=1, description="字段分隔符（如逗号、分号、制表符）")
    quotechar: str = Field('"', min_length=1, max_length=1, description="引号字符（用于包裹包含特殊字符的字段）")
    escapechar: str | None = Field(None, description="转义字符（用于转义引号等）")

    # 编码处理
    encoding_detection: bool = Field(True, description="是否自动检测编码（检测失败时使用 fallback_encodings）")
    fallback_encodings: list[str] = Field(
        default_factory=lambda: ["utf-8", "gbk", "latin1"],
        description="编码检测失败时尝试的编码列表（按优先级排序）",
    )

    # 错误处理
    on_bad_lines: Literal["error", "warn", "skip"] = Field(
        "warn", description="遇到坏行的处理方式：error-报错, warn-警告并跳过, skip-静默跳过"
    )

    def get_loader_class(self) -> builtins.type[DataSourceLoader]:
        """
        @methoddesc 获取 CSV 数据加载器类

        延迟导入 CSVLoader，避免循环依赖。
        CSVLoader 负责调用 pandas.read_csv 读取数据。

        Returns:
            CSVLoader 类
        """
        from ..loaders.csv_loader import CSVLoader

        return CSVLoader

    def to_display_dict(self) -> dict[str, Any]:
        """
        @methoddesc 转换为显示用的字典

        在基类的基础上增加 CSV 特有的展示字段，
        使用 repr() 显示分隔符以便区分空格等特殊字符。

        Returns:
            包含 delimiter、encoding 等 CSV 特有字段的字典
        """
        return {
            **super().to_display_dict(),
            "delimiter": repr(self.delimiter),  # 使用 repr 显示特殊字符
            "encoding": self.encoding,
        }
