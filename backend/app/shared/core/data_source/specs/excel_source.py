"""
@fileoverview Excel 数据源规范模块

功能概述:
- 定义 Excel 文件的数据源规格类
- 支持 .xlsx 和 .xls 格式
- 提供工作表名称/索引选择和读取引擎配置
- 支持数据类型自动推断开关

架构设计:
- 继承自 FileSourceSpec，复用文件通用配置
- 通过 @register_source_spec 装饰器自动注册到规格注册表
- 与 ExcelLoader 配对使用，实现 Excel 数据加载
- 连接键包含文件路径和工作表信息，确保唯一性

输入示例:
    spec = ExcelSourceSpec(
        path="data/users.xlsx",
        sheet="Sheet1",
        sheet_index=0,
        engine="openpyxl",
        dtype_inference=True
    )

输出示例:
    key = spec.get_connection_key()       # "absolute_path#Sheet1"
    loader_class = spec.get_loader_class()  # 返回 ExcelLoader
    display = spec.to_display_dict()
    # {"path": "data/users.xlsx", "sheet": "Sheet1", "engine": "openpyxl", ...}
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
class ExcelSourceSpec(FileSourceSpec):
    """
    @classdesc Excel 数据源配置

    支持 .xlsx（Excel 2007+）和 .xls（Excel 97-2003）格式的 Excel 文件。
    Excel 文件可以包含多个工作表（sheet），需要指定读取哪个工作表。

    特有配置:
        sheet: 工作表名称（如 "Sheet1"），默认 None（使用 sheet_index）
        sheet_index: 工作表索引（从0开始），当 sheet 未指定时使用
        engine: 读取引擎，openpyxl 支持 .xlsx，xlrd 支持 .xls
        dtype_inference: 是否自动推断数据类型（如将数字字符串转为数值）

    示例:
        ```yaml
        source:
          type: excel
          path: data/users.xlsx
          sheet: Sheet1
          header_row: 0
        ```
    """

    source_type: ClassVar[str] = "excel"
    type: str = "excel"

    # Excel 特有配置
    sheet: str | None = Field(None, description="工作表名称（优先使用）；如果为 None，则使用 sheet_index")
    sheet_index: int = Field(0, ge=0, description="工作表索引（从0开始），当 sheet 未指定时使用")
    engine: Literal["openpyxl", "xlrd"] = Field(
        "openpyxl", description="读取引擎：openpyxl（支持 .xlsx）或 xlrd（支持 .xls）"
    )

    # 数据类型推断
    dtype_inference: bool = Field(True, description="是否自动推断数据类型（如 '123' 转为整数 123）")

    def get_connection_key(self) -> str:
        """
        @methoddesc 获取连接标识符

        Excel 的连接键由文件路径和工作表信息组合而成，
        确保同一个文件的不同工作表被视为不同的数据源。

        Returns:
            "文件绝对路径#工作表名称" 格式的字符串
        """
        base_key = super().get_connection_key()  # 获取文件绝对路径
        # 如果指定了 sheet 名称则使用，否则使用 sheet_index
        sheet = self.sheet or f"sheet_{self.sheet_index}"
        return f"{base_key}#{sheet}"

    def get_loader_class(self) -> builtins.type[DataSourceLoader]:
        """
        @methoddesc 获取 Excel 数据加载器类

        延迟导入 ExcelLoader，避免循环依赖。
        ExcelLoader 负责调用 pandas.read_excel 读取数据。

        Returns:
            ExcelLoader 类
        """
        from ..loaders.excel_loader import ExcelLoader

        return ExcelLoader

    def to_display_dict(self) -> dict[str, Any]:
        """
        @methoddesc 转换为显示用的字典

        在基类的基础上增加 Excel 特有的展示字段。
        如果未指定 sheet 名称，则显示为 "sheet_索引" 形式。

        Returns:
            包含 sheet、engine 等 Excel 特有字段的字典
        """
        return {
            **super().to_display_dict(),
            "sheet": self.sheet or f"sheet_{self.sheet_index}",
            "engine": self.engine,
        }
